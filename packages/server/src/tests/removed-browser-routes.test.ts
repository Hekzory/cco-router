import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main() {
  const home = mkdtempSync(join(tmpdir(), "ccr-no-browser-"));
  const originalHome = process.env.HOME;
  const originalProfile = process.env.USERPROFILE;
  const originalFetch = globalThis.fetch;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  globalThis.fetch = async () => { throw new Error("Unexpected network request"); };
  let server: any;
  try {
    const { createServer } = await import("../server");
    server = await createServer({
      logger: false,
      initialConfig: { Providers: [], Router: {}, LOG: false },
    });
    server.app._server = server;
    await server.registerNamespace("/");
    await server.app.ready();

    for (const url of ["/ui", "/ui/", "/ui/index.html", "/qwen/auth", "/qwen/status", "/qwen/forget", "/api/update/check"]) {
      const response = await server.app.inject({ method: "GET", url });
      assert.equal(response.statusCode, 404, url);
      assert.equal(response.headers["set-cookie"], undefined);
    }
    for (const url of ["/api/auth/login", "/api/auth/logout", "/qwen/auth", "/api/debug/chat", "/api/debug/request", "/api/oauth/refresh", "/api/update/perform"]) {
      const response = await server.app.inject({ method: "POST", url, payload: {} });
      assert.equal(response.statusCode, 404, url);
      assert.equal(response.headers["set-cookie"], undefined);
    }

    const health = await server.app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 200);
    for (const url of ["/v1/messages", "/v1/chat/completions", "/v1/responses", "/v1/fim/completions", "/v1/messages/count_tokens"]) {
      assert.equal(server.app.hasRoute({ method: "POST", url }), true, url);
    }
    for (const url of ["/v1/models", "/api/config", "/api/transformers", "/api/presets", "/auth/callback", "/callback", "/oauth-callback"]) {
      assert.equal(server.app.hasRoute({ method: "GET", url }), true, url);
    }
    const transformers = await server.app.inject({ method: "GET", url: "/api/transformers" });
    assert.equal(transformers.statusCode, 200);
    assert.ok(transformers.json().transformers.some((item: any) => item.name === "codex"));
    assert.ok(!transformers.json().transformers.some((item: any) => ["qwen-auth", "fim.qwen"].includes(item.name)));
    console.log("removed-browser-routes: ok");
  } finally {
    await server?.app.close();
    globalThis.fetch = originalFetch;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalProfile;
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

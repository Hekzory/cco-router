import assert from "node:assert/strict";
import { ProviderService } from "../services/provider";
import { TransformerService } from "../services/transformer";

async function main() {
  const errors: string[] = [];
  const logger = {
    info() {}, debug() {}, warn() {},
    error(message: unknown) { errors.push(String(message)); },
  };
  const transformers = new TransformerService({ get(_key: string, fallback: unknown) { return fallback; } } as any, logger);
  await transformers.initialize();
  assert.equal(errors.length, 0);
  for (const name of ["cursor-sdk", "xai-auth", "chrome-on-device", "qwen-auth", "fim.qwen"]) {
    assert.equal(transformers.getTransformer(name), undefined);
    assert.ok(!transformers.getTransformersWithoutEndpoint().some((item) => item.name === name));
  }
  for (const name of ["Anthropic", "OpenAI", "openai-responses", "codex"]) {
    assert.ok(transformers.getTransformer(name), name);
  }

  // A stale provider must not silently run without its auth/transport adapter.
  for (const name of ["cursor-sdk", "xai-auth", "chrome-on-device", "qwen-auth", "fim.qwen", "missing-plugin"]) {
    for (const entry of [name, [name, {}]]) {
      for (const transformer of [{ use: [entry] }, { model: { use: [entry] } }]) {
        errors.length = 0;
        const providers = new ProviderService({
          get() {
            return [
              { name: "stale", api_base_url: "https://unused.example.test", api_key: "test", models: ["model"], transformer },
              { name: "working", api_base_url: "https://unused.example.test", api_key: "test", models: ["model"], transformer: { use: ["openai-responses", "codex"] } },
            ];
          },
        } as any, transformers, logger);
        assert.equal(providers.getProvider("stale"), undefined);
        assert.ok(providers.getProvider("working"));
        assert.equal(errors.length, 1);
        assert.ok(errors[0].includes(`Unknown transformer "${name}"`));
      }
    }
  }
  console.log("providers.removed-integrations: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

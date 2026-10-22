import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const dir = mkdtempSync(join(tmpdir(), "ccr-code-settings-"));
const cliDir = resolve(__dirname, "../..");
const routerHome = join(dir, ".claude-code-router");
const capture = join(dir, "captured-settings.json");
const stub = join(dir, "claude-stub.cjs");
const temp = join(dir, "tmp");
mkdirSync(temp);
mkdirSync(routerHome);
writeFileSync(stub, `
const fs = require("node:fs");
const args = process.argv.slice(2);
const settings = args[args.indexOf("--settings") + 1];
fs.writeFileSync(process.env.CCR_TEST_CAPTURE, fs.readFileSync(settings));
`);
const config = {
  CLAUDE_PATH: `${JSON.stringify(process.execPath)} ${JSON.stringify(stub)}`,
  NON_INTERACTIVE_MODE: true,
  StatusLine: { enabled: true },
};
const configText = JSON.stringify(config);
writeFileSync(join(routerHome, "config.json"), configText);

function run(command: string) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", command], {
    cwd: cliDir,
    env: {
      PATH: process.env.PATH,
      HOME: dir,
      USERPROFILE: dir,
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
      CCR_TEST_CAPTURE: capture,
    },
    input: "{}",
    encoding: "utf8",
    timeout: 15_000,
  });
}

function launchPreset(name: string, settings?: Record<string, unknown>) {
  const presetDir = join(routerHome, "presets", name);
  mkdirSync(presetDir, { recursive: true });
  writeFileSync(join(presetDir, "manifest.json"), JSON.stringify({
    name,
    version: "1.0.0",
    noServer: true,
    StatusLine: { enabled: true },
    claudeCodeSettings: settings,
  }));
  const result = run(name);
  assert.equal(result.status, 0, `${result.error || ""}\n${result.stderr}\n${result.stdout}`);
  assert.equal(existsSync(join(routerHome, ".claude-code-router.pid")), false);
  assert.equal(readFileSync(join(routerHome, "config.json"), "utf8"), configText);
  return JSON.parse(readFileSync(capture, "utf8"));
}

try {
  const help = run("-h");
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /status\s+Show server status/);
  assert.doesNotMatch(help.stdout, /statusline|qwen-auth|^\s+ui\s/im);

  const status = run("status");
  assert.equal(status.status, 0, status.stderr);
  assert.match(status.stdout, /Status: Not Running/);
  assert.equal(existsSync(join(routerHome, ".claude-code-router.pid")), false);

  for (const command of ["statusline", "ui", "qwen-auth"]) {
    const removed = run(command);
    assert.equal(removed.status, 1, removed.stderr);
    assert.match(removed.stdout, /Usage: ccr/);
    assert.equal(existsSync(join(routerHome, ".claude-code-router.pid")), false);
    assert.equal(readFileSync(join(routerHome, "config.json"), "utf8"), configText);
    assert.equal(existsSync(join(routerHome, "qwen_auth.json")), false);
  }

  // Obsolete router/preset settings must not inject a removed command.
  const plain = launchPreset("plain");
  assert.equal(plain.statusLine, undefined);
  assert.equal(plain.env.NON_INTERACTIVE_MODE, undefined);
  assert.equal(plain.env.CI, "true");

  // Generic Claude Code settings remain caller-owned, including native hooks.
  const native = { type: "command", command: "user-owned-status-command" };
  const custom = launchPreset("custom", {
    statusLine: native,
    env: { TEST_PRESET_ENV: "preserved" },
    permissions: { defaultMode: "default" },
  });
  assert.deepEqual(custom.statusLine, native);
  assert.equal(custom.env.TEST_PRESET_ENV, "preserved");
  assert.equal(custom.env.CI, "true");
  assert.deepEqual(custom.permissions, { defaultMode: "default" });
  console.log("code-launch.settings: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

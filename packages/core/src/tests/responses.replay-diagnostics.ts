import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReplayDiagnosticsWriter, writeReplayDiagnostics } from "../utils/responses-replay-diagnostics";

const root = await mkdtemp(join(tmpdir(), "ccr-replay-metrics-"));
try {
  const directory = join(root, "metrics");
  const writer = new ReplayDiagnosticsWriter(directory);
  writer.write({ phase: "lookup", lookups: 3, hits: 2, misses: 1, restoredOutputItems: 6,
    prompt: "SECRET_PROMPT", arguments: "SECRET_ARGUMENTS", ciphertext: "SECRET_CIPHER", sessionId: "SECRET_SESSION",
  } as any);
  await writer.flush();
  const path = join(directory, "replay.jsonl");
  const raw = await readFile(path, "utf8");
  assert.ok(!raw.includes("SECRET"));
  const row = JSON.parse(raw);
  assert.equal(row.lookups, 3);
  assert.equal(row.hits, 2);
  assert.equal(row.misses, 1);
  assert.deepEqual(Object.keys(row).sort(), ["timestamp", "pid", "phase", "dropped", "lookups", "hits", "misses", "restoredOutputItems"].sort());
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path)).mode & 0o777, 0o600);

  // Bounded queue drops diagnostics, never blocks the inference path.
  for (let i = 0; i < 200; i++) writer.write({ phase: "record", storedAliases: 1 });
  await writer.flush();
  writer.write({ phase: "lookup", lookups: 0, hits: -1, misses: NaN } as any);
  await writer.flush();
  const lines = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 66);
  assert.equal(lines.at(-1).dropped, 136);
  assert.equal(lines.at(-1).hits, undefined);
  assert.equal(lines.at(-1).misses, undefined);

  await writeFile(path, "x".repeat(2 * 1024 * 1024), { mode: 0o600 });
  writer.write({ phase: "lookup", hits: 1 });
  await writer.flush();
  assert.equal((await stat(join(directory, "replay.previous.jsonl"))).size, 2 * 1024 * 1024);
  assert.ok((await stat(path)).size < 1024);
  assert.equal((await readdir(directory)).length, 2);

  // No use of global debug flags: default-off is a strict boolean opt-in.
  writeReplayDiagnostics(undefined, { phase: "lookup" });
  writeReplayDiagnostics({ req: { server: { configService: { get: () => "true" } } } } as any, { phase: "lookup" });

  const unsafe = join(root, "unsafe");
  await mkdir(unsafe, { mode: 0o700 });
  const target = join(root, "untouched");
  await writeFile(target, "unchanged", { mode: 0o600 });
  await symlink(target, join(unsafe, "replay.jsonl"));
  const unsafeWriter = new ReplayDiagnosticsWriter(unsafe);
  unsafeWriter.write({ phase: "record", storedAliases: 7 });
  await unsafeWriter.flush();
  assert.equal(await readFile(target, "utf8"), "unchanged");
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("responses.replay-diagnostics: PASS");

import { constants } from "node:fs";
import { mkdir, open, rename, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TransformerContext } from "@/types/transformer";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PENDING = 64;
const COUNTERS = [
  "lookups", "hits", "misses", "restoredOutputItems", "restoredReasoningItems",
  "restoredRawArguments", "storedAliases", "skipped", "aliases", "chargedBytes",
  "evictions", "expirations",
] as const;

type ReplayCounters = Partial<Record<typeof COUNTERS[number], number>> & {
  phase: "lookup" | "record";
};

/** Numeric allowlist only: no prompts, arguments, ciphertext, model/session IDs. */
export class ReplayDiagnosticsWriter {
  private pending = 0;
  private dropped = 0;
  private failed = false;
  private queue = Promise.resolve();

  constructor(private readonly directory: string) {}

  write(counters: ReplayCounters): void {
    if (this.failed || this.pending >= MAX_PENDING) { this.dropped++; return; }
    const data: Record<string, string | number> = {
      timestamp: new Date().toISOString(), pid: process.pid,
      phase: counters.phase === "record" ? "record" : "lookup", dropped: this.dropped,
    };
    for (const key of COUNTERS) {
      const value = counters[key];
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) data[key] = value;
    }
    this.pending++;
    this.queue = this.queue.then(async () => {
      if (this.failed) return;
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const dir = await lstat(this.directory);
      if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) !== 0) throw new Error("Unsafe diagnostics directory");
      const path = join(this.directory, "replay.jsonl");
      const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
      let rotate = false;
      try {
        const stat = await file.stat();
        if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error("Unsafe diagnostics file");
        const line = JSON.stringify(data) + "\n";
        rotate = stat.size + Buffer.byteLength(line) > MAX_FILE_BYTES;
        if (!rotate) await file.write(line);
      } finally { await file.close(); }
      if (rotate) {
        const backup = join(this.directory, "replay.previous.jsonl");
        const previous = await lstat(backup).catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return undefined;
        });
        if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw new Error("Unsafe diagnostics backup");
        await rename(path, backup);
        const next = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await next.write(JSON.stringify(data) + "\n"); } finally { await next.close(); }
      }
    }).catch(() => {
      // Diagnostic disk errors must not fail inference or generate retry loops.
      this.failed = true;
    }).finally(() => { this.pending--; });
  }

  async flush(): Promise<void> { await this.queue; }
}

let writer: ReplayDiagnosticsWriter | undefined;

export function writeReplayDiagnostics(context: TransformerContext | undefined, counters: ReplayCounters): void {
  const enabled = (context?.req as any)?.server?.configService?.get?.("RESPONSES_REPLAY_DIAGNOSTICS") === true;
  if (!enabled) return;
  writer ??= new ReplayDiagnosticsWriter(join(homedir(), ".claude-code-router", "replay-diagnostics"));
  writer.write(counters);
}

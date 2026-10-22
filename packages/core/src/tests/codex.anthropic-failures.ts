import assert from "node:assert/strict";
import { AnthropicTransformer } from "../transformer/anthropic.transformer";
import { OpenAIResponsesTransformer } from "../transformer/openai.responses.transformer";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as any;
const encoder = new TextEncoder();
const context = { req: { id: "codex-failure-test" } } as any;
const upstreamError = { type: "api_error", code: "server_is_overloaded", message: "Overloaded" };

function sse(events: any[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function anthropic() {
  const transformer = new AnthropicTransformer();
  transformer.logger = logger;
  return transformer;
}

function responses() {
  const transformer = new OpenAIResponsesTransformer();
  transformer.logger = logger;
  return transformer;
}

function eventsFrom(raw: string): any[] {
  return raw.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)));
}

for (const partial of [false, true]) {
  const events: any[] = partial ? [
    { type: "response.output_text.delta", item_id: "msg_1", delta: "Partial" },
  ] : [];
  events.push({ type: "response.failed", response: { error: upstreamError } });
  const chat = await responses().transformResponseOut(sse(events));
  const out = await anthropic().transformResponseIn(chat, context);
  const converted = eventsFrom(await out.text());
  assert.equal(converted.filter((event) => event.type === "error").length, 1);
  assert.equal(converted.at(-1).error.message, "Overloaded");
  assert.ok(!converted.some((event) => event.type === "message_stop"));
  assert.ok(!converted.some((event) => event.type === "message_delta"));
}

// An error frame must cancel an upstream that stays open after sending it.
let cancelled = false;
const openStream = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: upstreamError })}\n\n`));
  },
  cancel() { cancelled = true; },
});
const failed = await anthropic().transformResponseIn(new Response(openStream, {
  headers: { "Content-Type": "text/event-stream" },
}), context);
assert.deepEqual(eventsFrom(await failed.text()), [{
  type: "error", error: { type: "api_error", message: "Overloaded" },
}]);
assert.equal(cancelled, true);

console.log("codex.anthropic-failures: PASS");

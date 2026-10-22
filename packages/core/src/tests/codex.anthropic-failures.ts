import assert from "node:assert/strict";
import { AnthropicTransformer } from "../transformer/anthropic.transformer";
import { CodexTransformer } from "../transformer/codex.transformer";
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

async function nonStream(events: any[], asArray = false): Promise<Response> {
  const transformer = new CodexTransformer();
  transformer.logger = logger;
  // Set caller intent without invoking OAuth or a real provider.
  (transformer as any).streamIntent.set(context.req.id, false);
  return transformer.transformResponseOut(asArray
    ? new Response(JSON.stringify(events), { headers: { "Content-Type": "application/json" } })
    : sse(events), context);
}

for (const asArray of [false, true]) {
  for (const event of [
    { type: "response.failed", response: { error: upstreamError } },
    { type: "error", error: upstreamError },
  ]) {
    await assert.rejects(nonStream([event], asArray), (error: any) => {
      assert.equal(error.statusCode, 503);
      assert.equal(error.code, "server_overloaded");
      return true;
    });
  }
  await assert.rejects(nonStream([
    { type: "response.output_item.done", item: { type: "message", content: [] } },
  ], asArray), (error: any) => error.code === "upstream_stream_incomplete");

  for (const incomplete of [false, true]) {
    const payload = {
      id: "resp_1", object: "response", model: "gpt-6.1-sol",
      status: incomplete ? "incomplete" : "completed",
      ...(incomplete ? { incomplete_details: { reason: "max_output_tokens" } } : {}),
      output: [{ type: "message", content: [{ type: "output_text", text: "Answer" }] }],
      usage: { input_tokens: 1200, output_tokens: 5, input_tokens_details: { cached_tokens: 1024 } },
    };
    const normalized = await nonStream([{
      type: incomplete ? "response.incomplete" : "response.completed", response: payload,
    }], asArray);
    assert.deepEqual(await normalized.clone().json(), payload);
    const chat = await responses().transformResponseOut(normalized);
    const result = await anthropic().transformResponseIn(chat, context);
    const message = await result.json();
    assert.equal(message.stop_reason, incomplete ? "max_tokens" : "end_turn");
    assert.equal(message.content[0].text, "Answer");
    assert.equal(message.usage.cache_read_input_tokens, 1024);
  }
}

console.log("codex.anthropic-failures: PASS");

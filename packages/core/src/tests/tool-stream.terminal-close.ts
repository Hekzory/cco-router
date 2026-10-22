import assert from "node:assert/strict";
import { AnthropicTransformer } from "../transformer/anthropic.transformer";
import { OpenAIResponsesTransformer } from "../transformer/openai.responses.transformer";
import { CodexTransformer } from "../transformer/codex.transformer";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as any;
const encoder = new TextEncoder();

function openSse(events: any[], rejectCancel = false) {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let cancellations = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(source) {
      controller = source;
      const raw = events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join("");
      // Exercise event boundaries crossing reads, without ever sending EOF.
      for (let i = 0; i < raw.length; i += 23) source.enqueue(encoder.encode(raw.slice(i, i + 23)));
    },
    cancel() {
      cancellations++;
      if (rejectCancel) return Promise.reject(new Error("Synthetic teardown failure"));
    },
  });
  return {
    response: new Response(stream, { headers: { "Content-Type": "text/event-stream" } }),
    cancelled: () => cancellations,
    cleanup() { try { controller.close(); } catch {} },
  };
}

async function consume(response: Response): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response.text(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Terminal stream waited for upstream EOF")), 1500); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function responses() {
  const transformer = new OpenAIResponsesTransformer();
  transformer.logger = logger;
  return transformer;
}

function anthropic() {
  const transformer = new AnthropicTransformer();
  transformer.logger = logger;
  return transformer;
}

for (const terminal of [
  { type: "response.completed", response: { id: "resp_ok", model: "test", status: "completed", output: [] } },
  { type: "response.incomplete", response: { id: "resp_short", model: "test", status: "incomplete", output: [], incomplete_details: { reason: "max_output_tokens" } } },
  { type: "response.failed", response: { error: { message: "Synthetic failure", type: "api_error" } } },
  { type: "error", message: "Synthetic failure", code: "synthetic_error" },
  "[DONE]",
]) {
  const source = openSse([terminal, { type: "response.output_text.delta", delta: "SHOULD_NOT_LEAK" }]);
  try {
    const raw = await consume(await responses().transformResponseOut(source.response));
    assert.equal(source.cancelled(), 1);
    assert.equal(raw.split("data: [DONE]").length - 1, 1);
    assert.ok(!raw.includes("SHOULD_NOT_LEAK"));
  } finally { source.cleanup(); }
}

for (const rejectCancel of [false, true]) {
  const source = openSse([
    { id: "chat_tool", model: "test", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_bash", type: "function", function: { name: "Bash", arguments: '{"command":"true"}' } }] }, finish_reason: null }] },
    { id: "chat_tool", model: "test", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    // Usage trailers arrive after finish_reason and before [DONE].
    { id: "chat_tool", model: "test", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    "[DONE]",
  ], rejectCancel);
  try {
    const raw = await consume(await anthropic().transformResponseIn(source.response, { req: { id: "chat-terminal" } }));
    assert.equal(source.cancelled(), 1);
    const events = raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5)));
    assert.equal(events.filter((event) => event.type === "message_stop").length, 1);
    assert.equal(events.find((event) => event.type === "message_delta").delta.stop_reason, "tool_use");
    assert.equal(events.find((event) => event.type === "message_delta").usage.output_tokens, 5);
    assert.ok(!events.some((event) => event.type === "error"));
  } finally { source.cleanup(); }
}

for (const name of ["Bash", "Agent"]) {
  const item = { type: "function_call", id: "fc_tool", call_id: "call_tool", name, arguments: name === "Bash" ? '{"command":"true"}' : '{"prompt":"Synthetic task"}' };
  const source = openSse([
    { type: "response.output_item.added", item: { ...item, arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: item.id, delta: item.arguments },
    { type: "response.completed", response: { id: "resp_tool", model: "test", status: "completed", output: [item] } },
  ]);
  try {
    const chat = await responses().transformResponseOut(source.response);
    const raw = await consume(await anthropic().transformResponseIn(chat, { req: { id: `responses-${name}` } }));
    const events = raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => JSON.parse(line.slice(5)));
    assert.equal(source.cancelled(), 1);
    assert.equal(events.filter((event) => event.type === "message_stop").length, 1);
    assert.equal(events.find((event) => event.type === "message_delta").delta.stop_reason, "tool_use");
    const call = events.find((event) => event.type === "content_block_start" && event.content_block.type === "tool_use");
    assert.equal(call.content_block.name, name);
    assert.equal(call.content_block.id, item.call_id);
    const input = events.filter((event) => event.type === "content_block_delta" && event.delta.type === "input_json_delta")
      .map((event) => event.delta.partial_json).join("");
    assert.deepEqual(JSON.parse(input), JSON.parse(item.arguments));
  } finally { source.cleanup(); }
}
for (const type of ["response.completed", "response.incomplete", "response.failed", "error"]) {
  const payload = { id: "resp_nonstream", model: "test", output: [], status: type === "response.incomplete" ? "incomplete" : "completed" };
  const source = openSse([{ type, response: payload, error: { message: "Synthetic error", code: "synthetic_error" } }]);
  const codex = new CodexTransformer();
  codex.logger = logger;
  (codex as any).streamIntent.set(type, false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = Promise.race([
      codex.transformResponseOut(source.response, { req: { id: type } }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Non-stream collector waited for EOF")), 1500); }),
    ]);
    if (type === "response.failed" || type === "error") {
      await assert.rejects(result, (error: any) => error.statusCode === 502);
    } else {
      assert.deepEqual(await (await result).json(), payload);
    }
    assert.equal(source.cancelled(), 1);
  } finally { clearTimeout(timer); source.cleanup(); }
}
console.log("tool-stream.terminal-close: PASS");

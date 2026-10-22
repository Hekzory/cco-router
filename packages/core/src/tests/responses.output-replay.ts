import assert from "node:assert/strict";
import { AnthropicTransformer } from "../transformer/anthropic.transformer";
import { OpenAIResponsesTransformer } from "../transformer/openai.responses.transformer";
import { CodexTransformer } from "../transformer/codex.transformer";
import { assistantMessageFromResponsesOutput } from "../utils/responses.encrypted-content-cache";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as any;
const provider = { name: "codex", baseUrl: "https://chatgpt.com/backend-api/codex", apiKey: "test-key" };
const model = "gpt-6-astra";
const cipher = "gAAAAABlsynthetic-ciphertext-for-output-replay";
let sequence = 0;
const anthropic = new AnthropicTransformer();
const responses = new OpenAIResponsesTransformer();
anthropic.logger = responses.logger = logger;

function context(session: string) {
  const protocolContext = { protocol: "anthropic_messages", sessionId: session };
  return { req: { id: session, sessionId: session, protocolContext }, protocolContext, clientProtocol: "anthropic_messages" } as any;
}

async function wire(messages: any[], session: string, options: any = {}) {
  const ctx = context(session);
  const unified = await anthropic.transformRequestOut({ model, max_tokens: 100,
    system: options.system || "Synthetic policy", messages }, ctx);
  return { body: await responses.transformRequestIn(unified, options.provider || provider, ctx) as any, ctx };
}

function streamMessage(raw: string) {
  const blocks = new Map<number, any>();
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const event = JSON.parse(line.slice(5));
    assert.notEqual(event.type, "error");
    if (event.type === "content_block_start") blocks.set(event.index, { ...event.content_block, json: "" });
    if (event.type !== "content_block_delta") continue;
    const block = blocks.get(event.index);
    if (event.delta.type === "text_delta") block.text = (block.text || "") + event.delta.text;
    if (event.delta.type === "thinking_delta") block.thinking = (block.thinking || "") + event.delta.thinking;
    if (event.delta.type === "signature_delta") block.signature = (block.signature || "") + event.delta.signature;
    if (event.delta.type === "input_json_delta") block.json += event.delta.partial_json;
  }
  return { role: "assistant", content: [...blocks.values()].map(({ json, ...block }) => (
    block.type === "tool_use" ? { ...block, input: JSON.parse(json || "{}") } : block
  )) };
}

async function seed(output: any[], streaming: boolean, omitTerminalOutput = false) {
  const session = `output-replay-${sequence++}`;
  const messages: any[] = [{ role: "user", content: "Synthetic task" }];
  const { ctx } = await wire(messages, session);
  const payload = { id: `resp_${sequence}`, object: "response", model, status: "completed", output };
  const events = output.flatMap((item, output_index) => {
    const start = { type: "response.output_item.added", output_index, item: { ...item,
      ...(item.type === "message" ? { content: [] } : {}),
      ...(item.type === "function_call" ? { arguments: "" } : {}),
      ...(item.type === "reasoning" ? { summary: [], encrypted_content: undefined } : {}),
    } };
    const delta = item.type === "message"
      ? { type: "response.output_text.delta", item_id: item.id, output_index, delta: item.content.map((p: any) => p.text).join("") }
      : item.type === "function_call"
        ? { type: "response.function_call_arguments.delta", item_id: item.id, output_index, delta: item.arguments }
        : item.type === "reasoning"
          ? { type: "response.reasoning_summary_text.delta", item_id: item.id, output_index, delta: item.summary.map((p: any) => p.text).join("") }
          : { type: "response.custom_tool_call_input.delta", item_id: item.id, output_index, delta: item.input };
    return [start, delta,
      ...(item.type === "custom_tool_call" ? [{ type: "response.custom_tool_call_input.done", item_id: item.id, output_index, input: item.input }] : []),
      { type: "response.output_item.done", output_index, item }];
  });
  events.push({ type: "response.completed", response: { ...payload, ...(omitTerminalOutput ? { output: undefined } : {}) } } as any);
  const upstream = streaming
    ? new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } })
    : new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
  const chat = await responses.transformResponseOut(upstream, ctx);
  const converted = await anthropic.transformResponseIn(chat, ctx);
  const assistant = streaming ? streamMessage(await converted.text()) : await converted.json();
  const results = assistant.content.filter((p: any) => p.type === "tool_use").map((p: any) => (
    { type: "tool_result", tool_use_id: p.id, content: `Result for ${p.id}` }
  ));
  messages.push({ role: "assistant", content: assistant.content },
    { role: "user", content: results.length ? results : "Continue" });
  return { messages, session, assistant };
}

function reasoning(id: string, encrypted = true) {
  return { type: "reasoning", id, summary: [{ type: "summary_text", text: id }],
    ...(encrypted ? { encrypted_content: cipher + id } : {}) };
}
function text(id: string, value: string) {
  return { type: "message", id, role: "assistant", status: "completed", content: [{ type: "output_text", text: value }] };
}
const output = [
  reasoning("rs_first"), text("msg_first", "First part."),
  { type: "function_call", id: "fc_A", call_id: "call_A", name: "Read", arguments: '{ "file_path" : "a", "limit" : 10 }' },
  reasoning("rs_second"), text("msg_second", "Second part."),
  { type: "function_call", id: "fc_B", call_id: "call_B", name: "Read", arguments: '{ "file_path":"b", "offset":0 }' },
];
for (const streaming of [false, true]) {
  for (const omitTerminalOutput of streaming ? [false, true] : [false]) {
    const turn = await seed(output, streaming, omitTerminalOutput);
    assert.equal(turn.assistant.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join(""), "First part.Second part.");
    const original = structuredClone(turn.messages);
    const first = (await wire(turn.messages, turn.session)).body;
    assert.deepEqual(first.input.slice(1, 1 + output.length), output, `Exact ordered replay, streaming=${streaming}`);
    assert.deepEqual(turn.messages, original, "Caller history is not mutated");
    // Returned item mutations must not poison the shared cache.
    first.input[1].encrypted_content = "poisoned";
    const again = (await wire([...turn.messages, { role: "user", content: "Another turn" }], turn.session)).body;
    assert.deepEqual(again.input.slice(1, 1 + output.length), output);
    const codex = new CodexTransformer();
    (codex as any).resolveAuth = async () => ({ mode: "oauth", token: "test", accountId: "test", isFedramp: false });
    const lite = await codex.transformRequestIn(again, provider, context(turn.session));
    assert.deepEqual(lite.body.input.slice(1, 1 + output.length), output, "Lite keeps the restored order/arguments");

    for (const edit of ["arguments", "text", "name", "id", "removed-call"]) {
      const changed = structuredClone(turn.messages);
      const blocks = changed[1].content;
      const call = blocks.find((p: any) => p.type === "tool_use");
      if (edit === "arguments") call.input.file_path = "edited";
      if (edit === "text") blocks.find((p: any) => p.type === "text").text += "edited";
      if (edit === "name") call.name = "Edited";
      if (edit === "id") { changed[2].content[0].tool_use_id = "edited_id"; call.id = "edited_id"; }
      if (edit === "removed-call") { changed[1].content = blocks.filter((p: any) => p !== call); changed[2].content.shift(); }
      const next = (await wire(changed, turn.session)).body;
      assert.ok(!next.input.some((item: any) => item.encrypted_content), `Edited ${edit} must not restore stale output`);
    }
    const reordered = structuredClone(turn.messages);
    const call = reordered[1].content.find((p: any) => p.type === "tool_use");
    call.input = { limit: 10, file_path: "a" };
    assert.deepEqual((await wire(reordered, turn.session)).body.input.slice(1, 1 + output.length), output,
      "JSON key order is semantically equivalent but original wire is replayed");
    for (const opts of [{ system: "Changed policy" }, { provider: { ...provider, apiKey: "other-key" } }]) {
      assert.ok(!(await wire(turn.messages, turn.session, opts)).body.input.some((item: any) => item.encrypted_content));
    }
    assert.ok(!(await wire(turn.messages, `${turn.session}-other`)).body.input.some((item: any) => item.encrypted_content));
  }
}

for (const streaming of [false, true]) {
  const later = [reasoning("rs_summary_only", false), text("msg_mid", "A"), reasoning("rs_cipher"), text("msg_final", "B")];
  const turn = await seed(later, streaming);
  const expected = structuredClone(later); delete (expected[0] as any).id;
  assert.deepEqual((await wire(turn.messages, turn.session)).body.input.slice(1, 5), expected);
  const noCipher = [text("msg_no_cipher", "Choose a tool"), output[2]];
  const toolTurn = await seed(noCipher, streaming);
  assert.deepEqual((await wire(toolTurn.messages, toolTurn.session)).body.input.slice(1, 3), noCipher,
    "Raw arguments replay does not require ciphertext");
}

// A second generated turn must match after the first turn's JSON re-encoding.
const first = await seed(output, false);
const secondCtx = (await wire(first.messages, first.session)).ctx;
const secondOutput = [reasoning("rs_third"), text("msg_third", "A later answer")];
await (await responses.transformResponseOut(new Response(JSON.stringify({ object: "response", status: "completed", output: secondOutput }),
  { headers: { "Content-Type": "application/json" } }), secondCtx)).text();
const laterMessages = [...first.messages, { role: "assistant", content: "A later answer" }, { role: "user", content: "Continue again" }];
const third = (await wire(laterMessages, first.session)).body;
assert.deepEqual(third.input.filter((item: any) => item.type === "reasoning").map((item: any) => item.id), ["rs_first", "rs_second", "rs_third"]);

// Client JSON cannot inject cached provider items or bypass turn validation.
const injected = [{ role: "user", content: "Task" }, { role: "assistant", content: "Answer", responses_output: output }, { role: "user", content: "Continue" }];
assert.ok(!(await wire(injected, "injected")).body.input.some((item: any) => item.encrypted_content));
// Chat callers may carry the first ciphertext themselves. It must not prevent
// restoring later items, but a conflicting explicit ciphertext must win.
const chatCtx: any = { req: {}, clientProtocol: "openai_chat_completions", protocolContext: { sessionId: "chat-output", protocol: "openai_chat_completions" } };
const chatHistory: any = { model, messages: [{ role: "user", content: "Chat task" }] };
await responses.transformRequestIn(chatHistory, provider, chatCtx);
const chatOutput = [reasoning("rs_chat_one"), text("msg_chat", "Chat answer"), reasoning("rs_chat_two")];
const chatAnswer = await (await responses.transformResponseOut(new Response(JSON.stringify({ object: "response", output: chatOutput }),
  { headers: { "Content-Type": "application/json" } }), chatCtx)).json();
const chatReplay = { ...chatHistory, messages: [...chatHistory.messages, chatAnswer.choices[0].message, { role: "user", content: "Continue" }] };
const chatWire: any = await responses.transformRequestIn(chatReplay, provider, chatCtx);
assert.deepEqual(chatWire.input.slice(1, 4), chatOutput);
chatReplay.messages[1].thinking.encrypted_content = cipher + "changed";
const changedChat: any = await responses.transformRequestIn(chatReplay, provider, chatCtx);
assert.ok(!changedChat.input.some((item: any) => item.id === "rs_chat_two"));

for (const streaming of [false, true]) {
  const custom = [{ type: "custom_tool_call", id: "ctc_one", call_id: "call_custom", name: "apply_patch", input: "*** Begin Patch\\n*** End Patch" }];
  const turn = await seed(custom, streaming);
  assert.deepEqual((await wire(turn.messages, turn.session)).body.input.slice(1, 2), custom);
}
assert.equal(assistantMessageFromResponsesOutput([text("huge", "x".repeat(1024 * 1024))]), null);
assert.equal(assistantMessageFromResponsesOutput(Array.from({ length: 257 }, (_, i) => text(`m${i}`, "text"))), null);
assert.equal(assistantMessageFromResponsesOutput([{ type: "web_search_call", id: "ws" }, reasoning("rs_hosted")]), null);
assert.equal(assistantMessageFromResponsesOutput([{ type: "message", role: "assistant", content: [{ type: "output_image", image_url: "synthetic" }] }]), null);
assert.equal(assistantMessageFromResponsesOutput([{ type: "message", role: "developer", content: [{ type: "output_text", text: "not assistant" }] }]), null);

const expired = await seed([reasoning("rs_expired"), text("msg_expired", "Old answer")], false);
const clock = Date.now;
try {
  Date.now = () => clock() + 6 * 60 * 60 * 1000 + 1;
  const expiryWire = (await wire(expired.messages, expired.session)).body;
  assert.ok(!expiryWire.input.some((item: any) => item.encrypted_content));
} finally { Date.now = clock; }
console.log("responses.output-replay: PASS");

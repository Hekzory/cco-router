import assert from "node:assert/strict";
import { AnthropicTransformer } from "../transformer/anthropic.transformer";
import { CodexTransformer } from "../transformer/codex.transformer";
import { OpenAIResponsesTransformer } from "../transformer/openai.responses.transformer";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as any;
const context = { req: { id: "codex-parallel-tools" } } as any;

function codex() {
  const transformer = new CodexTransformer();
  transformer.logger = logger;
  (transformer as any).resolveAuth = async () => ({
    mode: "oauth", token: "test-token", accountId: "test-account", isFedramp: false,
  });
  return transformer;
}

async function testParallelPolicy() {
  for (const model of ["gpt-6-astra", "gpt-6.1-sol", "gpt-6-sol", "gpt-6-luna", "gpt-5.5", "unlisted-model"]) {
    for (const client of [undefined, false, true]) {
      for (const configured of [undefined, false, true, "true"]) {
        const provider = { parallelToolCalls: configured };
        const result = await codex().transformRequestIn({
          model,
          input: [{ role: "user", content: "hello" }],
          ...(client !== undefined ? { parallel_tool_calls: client } : {}),
        }, provider, context);
        const supported = model === "gpt-5.5" || (model === "unlisted-model" && configured === true);
        assert.equal(result.body.parallel_tool_calls,
          supported && (client ?? configured === true),
          `${model}: client=${client}, provider=${configured}`);
      }
    }
  }
}

async function testAnthropicSerialChoice() {
  const anthropic = new AnthropicTransformer();
  anthropic.logger = logger;
  const unified = await anthropic.transformRequestOut({
    model: "gpt-5.5", max_tokens: 100,
    messages: [{ role: "user", content: "Read a file" }],
    tools: [{ name: "Read", input_schema: { type: "object", properties: {} } }],
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
  } as any, context);
  const responses = new OpenAIResponsesTransformer();
  responses.logger = logger;
  const wire = await responses.transformRequestIn(unified, {} as any, context);
  const result = await codex().transformRequestIn(wire, { parallelToolCalls: true }, context);
  assert.equal(result.body.parallel_tool_calls, false);
}

async function testStreamedCallsRoundTrip() {
  const transformer = codex();
  const responses = new OpenAIResponsesTransformer();
  const anthropic = new AnthropicTransformer();
  responses.logger = anthropic.logger = logger;
  await transformer.transformRequestIn({
    model: "gpt-5.5", stream: true, input: [{ role: "user", content: "Read both files" }],
    parallel_tool_calls: true,
  }, {}, context);

  const events = [
    { type: "response.output_item.added", item: { type: "function_call", id: "fc_A", call_id: "call_A", name: "Read" } },
    { type: "response.output_item.added", item: { type: "function_call", id: "fc_B", call_id: "call_B", name: "Read" } },
    { type: "response.function_call_arguments.delta", item_id: "fc_A", delta: '{"file_' },
    { type: "response.function_call_arguments.delta", item_id: "fc_B", delta: '{"file_path":"b.ts"}' },
    { type: "response.function_call_arguments.delta", item_id: "fc_A", delta: 'path":"a.ts"}' },
    { type: "response.completed", response: {
      id: "resp_parallel", model: "gpt-5.5", status: "completed",
      output: [
        { type: "function_call", id: "fc_A", call_id: "call_A", name: "Read", arguments: '{"file_path":"a.ts"}' },
        { type: "function_call", id: "fc_B", call_id: "call_B", name: "Read", arguments: '{"file_path":"b.ts"}' },
      ],
    } },
  ];
  const upstream = new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
  const codexOut = await transformer.transformResponseOut(upstream, context);
  const chat = await responses.transformResponseOut(codexOut);
  const output = await anthropic.transformResponseIn(chat, context);
  const converted = (await output.text()).split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5)));

  const blocks = new Map<number, { type: string; id: string; name: string; input: any; json: string }>();
  for (const event of converted) {
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      assert.ok(!blocks.has(event.index));
      blocks.set(event.index, { ...event.content_block, json: "" });
    } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
      assert.ok(blocks.has(event.index));
      blocks.get(event.index)!.json += event.delta.partial_json;
    }
  }
  const calls = [...blocks.values()].map(({ json, ...block }) => ({ ...block, input: JSON.parse(json) }));
  assert.deepEqual(calls, [
    { type: "tool_use", id: "call_A", name: "Read", input: { file_path: "a.ts" } },
    { type: "tool_use", id: "call_B", name: "Read", input: { file_path: "b.ts" } },
  ]);
  assert.equal(converted.filter((event) => event.type === "message_stop").length, 1);
  assert.equal(converted.find((event) => event.type === "message_delta").delta.stop_reason, "tool_use");

  const unified = await anthropic.transformRequestOut({
    model: "gpt-5.5", max_tokens: 100,
    messages: [
      { role: "user", content: "Read both files" },
      { role: "assistant", content: calls },
      { role: "user", content: [
        { type: "tool_result", tool_use_id: "call_A", content: "file A" },
        { type: "tool_result", tool_use_id: "call_B", content: "file B" },
      ] },
    ],
  } as any, context);
  const wire = await responses.transformRequestIn(unified, {} as any, context);
  const replay = await codex().transformRequestIn(wire, {}, context);
  assert.deepEqual(replay.body.input.filter((item: any) => item.type?.startsWith("function_call")), [
    { type: "function_call", call_id: "call_A", name: "Read", arguments: '{"file_path":"a.ts"}', status: "completed" },
    { type: "function_call", call_id: "call_B", name: "Read", arguments: '{"file_path":"b.ts"}', status: "completed" },
    { type: "function_call_output", call_id: "call_A", output: "file A" },
    { type: "function_call_output", call_id: "call_B", output: "file B" },
  ]);
}

await testParallelPolicy();
await testAnthropicSerialChoice();
await testStreamedCallsRoundTrip();
console.log("codex.parallel-tools: PASS");

import assert from "node:assert/strict";
import { AnthropicTransformer } from "../transformer/anthropic.transformer";
import { OpenAIResponsesTransformer } from "../transformer/openai.responses.transformer";
import { CodexTransformer } from "../transformer/codex.transformer";

// Small Claude-facing definitions: optional fields must stay optional, not
// become required or nullable as a side effect of crossing protocols.
const tools = [
  {
    name: "Agent",
    description: "Run a task in a subagent.",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        isolation: { type: "string", enum: ["worktree"] },
        options: {
          type: "object",
          properties: {
            label: { type: "string" },
            worktree: { type: "string" },
          },
          required: ["label"],
          additionalProperties: false,
        },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    name: "Read",
    description: "Read a file.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        offset: { type: "integer" },
        limit: { type: "integer" },
      },
      required: ["file_path"],
      additionalProperties: false,
    },
  },
  {
    name: "Edit",
    description: "Edit a file.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["file_path", "old_string", "new_string"],
      additionalProperties: false,
    },
  },
];

async function toResponses(definitions: any[] = tools) {
  const context = {};
  const unified = await new AnthropicTransformer().transformRequestOut(
    {
      model: "gpt-6.1-sol",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Inspect the project." }],
      tools: structuredClone(definitions),
    },
    context
  );
  for (let i = 0; i < definitions.length; i++) {
    assert.deepEqual(unified.tools![i].function.parameters, definitions[i].input_schema);
  }
  return new OpenAIResponsesTransformer().transformRequestIn(
    unified,
    {} as any,
    context
  );
}

async function testSchemasStayNonStrict() {
  const wire = await toResponses();
  assert.deepEqual(wire.tools, tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
    strict: false,
  })));

  // Lite relocates the same tools into additional_tools; it must not change
  // the schema or strip the explicit non-strict setting. Auth is fully mocked.
  const codex = new CodexTransformer();
  (codex as any).resolveAuth = async () => ({
    mode: "oauth",
    token: "test-token",
    accountId: "test-account",
    isFedramp: false,
  });
  const { body } = await codex.transformRequestIn(
    structuredClone(wire),
    { baseUrl: "https://chatgpt.com/backend-api/codex" } as any,
    {}
  );
  assert.equal(body.tools, undefined);
  assert.deepEqual(body.input[0], {
    type: "additional_tools",
    role: "developer",
    tools: [{
      type: "namespace",
      name: "functions",
      description: "",
      tools: wire.tools,
    }],
  });
}

async function testExplicitStrictFlags() {
  const responses = new OpenAIResponsesTransformer();
  // Unified (Chat Completions) callers may explicitly opt either way.
  for (const strict of [false, true]) {
    for (const tool of tools) {
      const wire: any = await responses.transformRequestIn({
        model: "gpt-5.5",
        messages: [{ role: "user", content: "Inspect the project." }],
        tools: [{
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: structuredClone(tool.input_schema),
            strict,
          },
        }],
      } as any, {} as any, {});
      assert.equal(wire.tools[0].strict, strict);
      assert.deepEqual(wire.tools[0].parameters, tool.input_schema);

      // Responses inbound must also retain explicitly supplied strict flags
      // through Unified; false must not disappear through a truthiness check.
      const unified = await responses.transformRequestOut({
        model: "gpt-5.5",
        input: "Inspect the project.",
        tools: [{ type: "function", name: tool.name, parameters: tool.input_schema, strict }],
      } as any, {});
      assert.equal(unified.tools![0].function.strict, strict);
      const roundTrip: any = await responses.transformRequestIn(unified, {} as any, {});
      assert.equal(roundTrip.tools[0].strict, strict);
      assert.deepEqual(roundTrip.tools[0].parameters, tool.input_schema);
    }
  }
}

async function testArgumentsRoundTrip() {
  // These are canned backend replies, not a claim about what a model will
  // generate. Both omission and explicit user-requested options must survive.
  const calls = [
    { name: "Agent", input: { prompt: "Inspect the project." } },
    { name: "Agent", input: { prompt: "Inspect the project.", options: { label: "review" } } },
    { name: "Read", input: { file_path: "/tmp/example.ts" } },
    { name: "Agent", input: { prompt: "Inspect in a worktree.", isolation: "worktree", options: { label: "review", worktree: "/tmp/requested" } } },
    { name: "Read", input: { file_path: "/tmp/example.ts", offset: 12, limit: 30 } },
    { name: "Read", input: { file_path: "/tmp/example.ts", offset: 0 } },
    { name: "Edit", input: { file_path: "/tmp/example.ts", old_string: "old", new_string: "new", replace_all: false } },
  ];
  const responses = new OpenAIResponsesTransformer();
  const anthropic = new AnthropicTransformer();
  anthropic.logger = { debug() {}, info() {}, warn() {}, error() {} } as any;
  const output = calls.map(({ name, input }, i) => ({
    type: "function_call",
    id: `fc_${i}`,
    call_id: `call_${i}`,
    name,
    arguments: JSON.stringify(input),
  }));
  const payload = {
    id: "resp_optional_tools",
    object: "response",
    model: "gpt-6.1-sol",
    output,
    usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
  };
  const unified = await responses.transformResponseOut(new Response(
    JSON.stringify(payload),
    { headers: { "Content-Type": "application/json" } }
  ));
  const result = await anthropic.transformResponseIn(unified, { req: { id: "optional-json" } });
  const body = await result.json();
  assert.deepEqual(body.content.map(({ type, name, input }: any) => ({ type, name, input })),
    calls.map((call) => ({ type: "tool_use", ...call })));

  const events = output.flatMap((item, output_index) => [
    { type: "response.output_item.added", output_index, item: { ...item, arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: item.id, delta: item.arguments },
    { type: "response.output_item.done", output_index, item },
  ]);
  events.push({ type: "response.completed", response: payload } as any);
  const stream = await responses.transformResponseOut(new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "Content-Type": "text/event-stream" } }
  ));
  const claudeStream = await anthropic.transformResponseIn(stream, { req: { id: "optional-stream" } });
  const blocks = new Map<number, { name: string; json: string }>();
  for (const line of (await claudeStream.text()).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      blocks.set(event.index, { name: event.content_block.name, json: "" });
    } else if (event.type === "content_block_delta" && event.delta.type === "input_json_delta") {
      blocks.get(event.index)!.json += event.delta.partial_json;
    }
  }
  assert.deepEqual([...blocks.values()].map(({ name, json }) => ({ name, input: JSON.parse(json) })), calls);
}

async function main() {
  await testSchemasStayNonStrict();
  await testExplicitStrictFlags();
  await testArgumentsRoundTrip();
  console.log("responses.optional-tool-arguments: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

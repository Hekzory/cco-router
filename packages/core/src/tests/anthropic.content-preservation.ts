import assert from "node:assert/strict";
import { AnthropicTransformer } from "../transformer/anthropic.transformer";
import { OpenAIResponsesTransformer } from "../transformer/openai.responses.transformer";
import { anthropicToolResultToUnified } from "../utils/tool-content";


async function toResponses(messages: any[]): Promise<Record<string, any>> {
  const context = {};
  const unified = await new AnthropicTransformer().transformRequestOut(
    { model: "gpt-6.1-sol", max_tokens: 1024, messages },
    context
  );
  return new OpenAIResponsesTransformer().transformRequestIn(
    unified,
    {} as any,
    context
  );
}

async function testToolReferences() {
  assert.equal(
    anthropicToolResultToUnified([
      { type: "tool_reference", tool_name: "mcp__files__read" },
    ]),
    "Tool reference: mcp__files__read"
  );

  const result = await toResponses([
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "call_search",
          name: "ToolSearch",
          input: { query: "files" },
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "call_search",
          content: [
            { type: "text", text: "Found tools:" },
            { type: "tool_reference", tool_name: "mcp__files__read" },
            { type: "tool_reference", tool_name: "mcp__files__list" },
          ],
        },
      ],
    },
  ]);
  const output = result.input.find(
    (item: any) => item.type === "function_call_output"
  );
  assert.deepEqual(output, {
    type: "function_call_output",
    call_id: "call_search",
    output: [
      { type: "input_text", text: "Found tools:" },
      { type: "input_text", text: "Tool reference: mcp__files__read" },
      { type: "input_text", text: "Tool reference: mcp__files__list" },
    ],
  });
  assert.equal(result.tools, undefined, "references must not add tool schemas");
}

async function main() {
  await testToolReferences();
  console.log("anthropic.content-preservation: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import assert from "node:assert/strict";
import { AnthropicTransformer } from "../transformer/anthropic.transformer";
import { OpenAIResponsesTransformer } from "../transformer/openai.responses.transformer";
import { anthropicToolResultToUnified } from "../utils/tool-content";

const IMAGE_DATA = "iVBORw0KGgo=";
const PDF_DATA = "JVBERi0xLjQ=";

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

async function testUserDocuments() {
  const result = await toResponses([
    {
      role: "user",
      content: [
        { type: "text", text: "Compare these documents with the screenshot." },
        {
          type: "document",
          title: "inline.pdf",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: PDF_DATA,
          },
        },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: IMAGE_DATA },
        },
        {
          type: "document",
          title: "remote.pdf",
          source: { type: "url", url: "https://example.com/document.pdf" },
        },
        { type: "text", text: "Keep the original order." },
      ],
    },
  ]);
  assert.deepEqual(result.input, [
    {
      type: "message",
      role: "user",
      content: [
        { type: "input_text", text: "Compare these documents with the screenshot." },
        {
          type: "input_file",
          filename: "inline.pdf",
          file_data: `data:application/pdf;base64,${PDF_DATA}`,
        },
        { type: "input_image", image_url: `data:image/png;base64,${IMAGE_DATA}` },
        {
          type: "input_file",
          filename: "remote.pdf",
          file_url: "https://example.com/document.pdf",
        },
        { type: "input_text", text: "Keep the original order." },
      ],
    },
  ]);
}

async function testDocumentMetadataAndUnsupportedSources() {
  const cacheControl = { type: "ephemeral" };
  const result = await new AnthropicTransformer().transformRequestOut({
    model: "gpt-6.1-sol",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            title: "cached.pdf",
            cache_control: cacheControl,
            source: { type: "base64", media_type: "application/pdf", data: PDF_DATA },
          },
        ],
      },
    ],
  });
  assert.deepEqual(result.messages[0].content, [
    {
      type: "file",
      filename: "cached.pdf",
      file_data: `data:application/pdf;base64,${PDF_DATA}`,
      media_type: "application/pdf",
      cache_control: cacheControl,
    },
  ]);

  for (const source of [undefined, { type: "file", file_id: "file_123" }]) {
    await assert.rejects(
      toResponses([
        { role: "user", content: [{ type: "document", source }] },
      ]),
      /Unsupported Anthropic document source/
    );
  }
}

async function main() {
  await testToolReferences();
  await testUserDocuments();
  await testDocumentMetadataAndUnsupportedSources();
  console.log("anthropic.content-preservation: ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

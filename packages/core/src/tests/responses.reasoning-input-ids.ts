import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { OpenAITransformer } from "../transformer/openai.transformer";
import { OpenAIResponsesTransformer } from "../transformer/openai.responses.transformer";
import { UnifiedChatRequest } from "../types/llm";
import {
  responsesReasoningInputItemFromThinking,
  unifiedResponseToResponses,
  uniquifyReasoningItemIds,
} from "../utils/openai.responses.util";

// A Responses provider resolves a reasoning input item without ciphertext by
// id. CCR must never send an id it minted from reasoning text: Muse/Zen 400s
// with "Referenced reasoning item … was not found or has expired". Text-only
// reasoning travels as a summary-only item without `id` instead.

const provider = {
  name: "opencode-responses",
  baseUrl: "https://opencode.ai/zen/v1/responses",
};
const MODEL = "muse-spark-1.3-contributor-free";
const CIPHER = "gAAAAABlencrypted-muse-reasoning-for-input-id-tests";

function chatContext(sessionId: string) {
  const protocolContext = { protocol: "openai_chat_completions", sessionId };
  return {
    req: { protocolContext, sessionId },
    clientProtocol: "openai_chat_completions",
    protocolContext,
  };
}

function responsesContext() {
  return {
    req: {},
    clientProtocol: "openai_responses",
    protocolContext: { protocol: "openai_responses" },
  };
}

function reasoningItems(transformed: any): any[] {
  return (transformed.input || []).filter(
    (item: any) => item?.type === "reasoning"
  );
}

async function transformIn(
  messages: UnifiedChatRequest["messages"],
  context: unknown
): Promise<any> {
  return new OpenAIResponsesTransformer().transformRequestIn(
    {
      model: MODEL,
      stream: false,
      messages,
      reasoning: { effort: "medium", enabled: true },
    },
    provider as any,
    context as any
  );
}

function assertSummaryOnly(items: any[], text: string) {
  assert.equal(items.length, 1);
  assert.equal("id" in items[0], false, "summary-only item must carry no id");
  assert.equal(items[0].encrypted_content, undefined);
  assert.deepEqual(items[0].summary, [{ type: "summary_text", text }]);
}

async function testChatFinalTurnReasoningTextIsSummaryOnly() {
  const transformed = await transformIn(
    [
      { role: "user", content: "Is 391 prime?" },
      {
        role: "assistant",
        content: "No, 391 = 17 × 23.",
        reasoning_content: "Try small primes: 17 × 23 = 391.",
      } as any,
      { role: "user", content: "And 397?" },
    ],
    chatContext("chat-final-turn")
  );

  assertSummaryOnly(reasoningItems(transformed), "Try small primes: 17 × 23 = 391.");
  const assistant = transformed.input.find(
    (item: any) => item?.type === "message" && item.role === "assistant"
  );
  assert.equal(assistant?.content?.[0]?.text, "No, 391 = 17 × 23.");
}

async function testChatToolTurnCacheMissIsSummaryOnly() {
  const transformed = await transformIn(
    [
      { role: "user", content: "Weather in Paris?" },
      {
        role: "assistant",
        content: null,
        reasoning_content: "I should call get_weather for Paris.",
        tool_calls: [
          {
            id: "call_never_cached",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"Paris"}' },
          },
        ],
      } as any,
      { role: "tool", tool_call_id: "call_never_cached", content: "Sunny" },
    ],
    chatContext("chat-tool-cache-miss")
  );

  assertSummaryOnly(
    reasoningItems(transformed),
    "I should call get_weather for Paris."
  );
  const call = transformed.input.find(
    (item: any) => item?.type === "function_call"
  );
  assert.equal(call?.call_id, "call_never_cached");
}

async function testChatToolTurnCacheHitReplaysRealItem() {
  const transformer = new OpenAIResponsesTransformer();
  const sessionId = "chat-tool-cache-hit";
  const prompt = "Weather in Lyon?";
  const toolCall = {
    id: "call_cached_lyon",
    type: "function" as const,
    function: { name: "get_weather", arguments: '{"city":"Lyon"}' },
  };

  const seedContext = chatContext(sessionId);
  await transformer.transformRequestIn(
    {
      model: MODEL,
      stream: false,
      messages: [{ role: "user", content: prompt }],
      reasoning: { effort: "medium", enabled: true },
    },
    provider as any,
    seedContext as any
  );
  await (
    await transformer.transformResponseOut(
      new Response(
        JSON.stringify({
          id: "resp_lyon",
          object: "response",
          model: MODEL,
          created_at: 1,
          output: [
            {
              type: "reasoning",
              id: "rs_server_minted_lyon",
              summary: [{ type: "summary_text", text: "Call the tool." }],
              encrypted_content: CIPHER,
            },
            {
              type: "function_call",
              call_id: toolCall.id,
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" } }
      ),
      seedContext as any
    )
  ).text();

  const transformed: any = await transformer.transformRequestIn(
    {
      model: MODEL,
      stream: false,
      messages: [
        { role: "user", content: prompt },
        {
          role: "assistant",
          content: null,
          reasoning_content: "Call the tool.",
          tool_calls: [toolCall],
        } as any,
        { role: "tool", tool_call_id: toolCall.id, content: "Cloudy" },
      ],
      reasoning: { effort: "medium", enabled: true },
    },
    provider as any,
    chatContext(sessionId) as any
  );

  const items = reasoningItems(transformed);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "rs_server_minted_lyon");
  assert.equal(items[0].encrypted_content, CIPHER);
}

async function testResponsesClientCarriedIdIsPreserved() {
  const transformed = await transformIn(
    [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: "hello",
        thinking: { content: "greet back", id: "rs_carried_by_client" },
      } as any,
      { role: "user", content: "again" },
    ],
    responsesContext()
  );

  const items = reasoningItems(transformed);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "rs_carried_by_client");
  assert.equal(items[0].encrypted_content, undefined);
  assert.equal(items[0].summary?.[0]?.text, "greet back");
}

function testInputBuilderNeverMintsIdForText() {
  assertSummaryOnly(
    [responsesReasoningInputItemFromThinking({ content: "text only" })],
    "text only"
  );
  assertSummaryOnly(
    [
      responsesReasoningInputItemFromThinking({
        content: "placeholder id",
        id: "rs_anon",
      }),
    ],
    "placeholder id"
  );
  assertSummaryOnly(
    [
      responsesReasoningInputItemFromThinking({
        content: "anthropic signed",
        signature: "anth-sig",
      }),
    ],
    "anthropic signed"
  );
  assert.equal(responsesReasoningInputItemFromThinking({ content: "" }), null);
  const withCipher = responsesReasoningInputItemFromThinking({
    content: "",
    encrypted_content: CIPHER,
  });
  assert.ok(withCipher?.id?.startsWith("rs_"));
  assert.equal(withCipher.encrypted_content, CIPHER);
}

function testUniquifyNeverMintsReferences() {
  const summary = [{ type: "summary_text", text: "x" }];
  const items: any[] = [
    { type: "reasoning", id: "rs_ref", summary: [] },
    { type: "message", role: "assistant", content: [] },
    { type: "reasoning", id: "rs_ref", summary },
    { type: "reasoning", id: "rs_anon", summary: [] },
    { type: "reasoning", id: "rs_anon", summary },
    { type: "reasoning", summary },
    { type: "reasoning", summary },
    { type: "reasoning", id: "rs_dup", encrypted_content: "enc-a", summary: [] },
    { type: "reasoning", id: "rs_dup", encrypted_content: "enc-b", summary: [] },
  ];

  const dropped = uniquifyReasoningItemIds(items);

  // Duplicate reference and the empty placeholder item are dropped.
  assert.equal(dropped, 2);
  assert.equal(items.length, 7);
  assert.equal(items[0].id, "rs_ref");
  assert.equal(items[1].type, "message");
  // Placeholder id is removed, not re-minted; id-less items stay id-less.
  for (const item of items.slice(2, 5)) {
    assert.equal("id" in item, false);
    assert.deepEqual(item.summary, summary);
  }
  assert.equal(items[5].id, "rs_dup");
  assert.notEqual(items[6].id, "rs_dup");
  assert.ok(items[6].id.startsWith("rs_"));
  assert.equal(items[6].encrypted_content, "enc-b");
}

function testClientOutputStillLabelsSummaryOnlyReasoning() {
  const response = unifiedResponseToResponses({
    choices: [
      {
        message: {
          role: "assistant",
          content: "done",
          reasoning_content: "summary only",
        },
        finish_reason: "stop",
      },
    ],
  });
  const reasoning = response.output.find(
    (item: any) => item?.type === "reasoning"
  );
  assert.ok(reasoning?.id?.startsWith("rs_"));
  assert.equal(reasoning.summary?.[0]?.text, "summary only");
}


function testGeneratedReasoningIdsCannotCollide() {
  const seed = "cipher-collision";
  const id = `rs_${createHash("sha256").update(seed).digest("hex").slice(0, 24)}`;
  const items = [
    { type: "reasoning", id, encrypted_content: "other-cipher", summary: [] },
    { type: "reasoning", encrypted_content: seed, summary: [] },
    { type: "reasoning", encrypted_content: seed, summary: [] },
  ];
  uniquifyReasoningItemIds(items);
  assert.equal(new Set(items.map((item: any) => item.id)).size, items.length);
  const again = structuredClone(items);
  uniquifyReasoningItemIds(again);
  assert.deepEqual(again, items, "normalization must be idempotent");
  const futureReference: any[] = [
    { type: "reasoning", encrypted_content: seed, summary: [] },
    { type: "reasoning", id, summary: [] },
  ];
  assert.equal(uniquifyReasoningItemIds(futureReference), 0);
  assert.notEqual(futureReference[0].id, id);
  assert.equal(futureReference[1].id, id, "a later provider reference must survive");
}

async function main() {
  testGeneratedReasoningIdsCannotCollide();
  await testChatFinalTurnReasoningTextIsSummaryOnly();
  await testChatToolTurnCacheMissIsSummaryOnly();
  await testChatToolTurnCacheHitReplaysRealItem();
  await testResponsesClientCarriedIdIsPreserved();
  testInputBuilderNeverMintsIdForText();
  testUniquifyNeverMintsReferences();
  testClientOutputStillLabelsSummaryOnlyReasoning();
  console.log("responses.reasoning-input-ids: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

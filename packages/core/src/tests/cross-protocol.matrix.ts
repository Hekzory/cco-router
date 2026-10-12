/**
 * Inbound × outbound matrix: every inbound protocol must produce a valid
 * outbound shape for every provider family, and cross-protocol invariants
 * (include, encrypted_content, call_id, web_search, custom_tool) must hold.
 */
import assert from "node:assert/strict";
import { AnthropicTransformer } from "../transformer/anthropic.transformer";
import { CodexTransformer } from "../transformer/codex.transformer";
import { GeminiTransformer } from "../transformer/gemini.transformer";
import { OpenAIResponsesTransformer } from "../transformer/openai.responses.transformer";
import { OpenAITransformer } from "../transformer/openai.transformer";
import { buildRequestBody as buildGeminiBody } from "../utils/gemini.util";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as any;

function sessionCtx(sessionId = "matrix-session") {
  return { req: { id: "matrix", sessionId, log: logger } } as any;
}

async function toUnifiedFromAnthropic() {
  return new AnthropicTransformer().transformRequestOut({
    model: "claude-sonnet-4-20250514",
    max_tokens: 64,
    system: [{ type: "text", text: "sys" }],
    messages: [
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "plan", signature: "sig-not-id" },
          { type: "text", text: "answer" },
          { type: "tool_use", id: "call_matrix_1", name: "Read", input: { path: "a.ts" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_matrix_1", content: "ok" }] },
    ],
    tools: [
      { name: "Read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } } } },
      { name: "web_search", description: "search", input_schema: { type: "object", properties: { query: { type: "string" } } } },
    ],
  } as any);
}

async function toUnifiedFromChat() {
  // Chat inbound is already Unified-ish; simulate via direct Unified shape
  return {
    model: "gpt-4o",
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_chat_1", type: "function", function: { name: "Read", arguments: '{"path":"a.ts"}' } }],
        reasoning_content: "chat thinking",
      },
      { role: "tool", tool_call_id: "call_chat_1", content: "ok" },
    ],
    tools: [
      { type: "function", function: { name: "Read", description: "read", parameters: { type: "object", properties: { path: { type: "string" } } } } },
      { type: "function", function: { name: "web_search", description: "search", parameters: { type: "object", properties: { query: { type: "string" } } } } },
    ],
    reasoning: { effort: "high", enabled: true },
  } as any;
}

async function toUnifiedFromResponses() {
  const { responsesRequestToUnified, createCallIdMap } = await import("../utils/openai.responses.util");
  const map = createCallIdMap();
  return responsesRequestToUnified(
    {
      model: "gpt-5",
      instructions: "sys",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
        { type: "reasoning", id: "rs_matrix", summary: [{ type: "summary_text", text: "reasoning" }], encrypted_content: "CIPHER_MATRIX" },
        { type: "function_call", call_id: "call_resp_1", name: "Read", arguments: '{"path":"a.ts"}' },
        { type: "custom_tool_call", call_id: "call_custom_1", name: "MyTool", input: "freeform text" },
        { type: "function_call_output", call_id: "call_resp_1", output: "ok" },
      ],
      tools: [
        { type: "function", name: "Read", description: "read", parameters: { type: "object", properties: { path: { type: "string" } } } },
        { type: "function", name: "MyTool", description: "custom", parameters: { type: "object", properties: { input: { type: "string" } } } },
        { type: "web_search" },
      ],
      include: ["reasoning.encrypted_content"],
      store: false,
    } as any,
    map
  );
}

async function testAnthropicToAllOutbounds() {
  const unified = await toUnifiedFromAnthropic();
  // Anthropic → Anthropic (via transformer)
  const anthTf = new AnthropicTransformer();
  (anthTf as any).logger = logger;
  const anthBody = (await anthTf.transformRequestIn(structuredClone(unified), { name: "anthropic", apiKey: "k", baseUrl: "https://api.anthropic.com", models: [] } as any, sessionCtx()) as any).body;
  assert.ok(Array.isArray(anthBody.messages));
  assert.ok(anthBody.messages.some((m: any) => m.role === "assistant"));

  // Anthropic → Responses (encrypted_content requested)
  const respTf = new OpenAIResponsesTransformer();
  (respTf as any).logger = logger;
  const respBody = await respTf.transformRequestIn(structuredClone(unified), { name: "openai", baseUrl: "https://api.openai.com/v1" } as any, { req: { id: "matrix", sessionId: "matrix-session", log: logger, protocolContext: { protocol: "anthropic_messages" } }, clientProtocol: "anthropic_messages", protocolContext: { protocol: "anthropic_messages" } } as any);
  assert.ok(Array.isArray((respBody as any).input));
  assert.ok(((respBody as any).include || []).includes("reasoning.encrypted_content"), "Anthropic→Responses must request encrypted_content");
  assert.ok((respBody as any).input.some((i: any) => i.type === "reasoning"));

  // Anthropic → Chat (OpenAI)
  const chatBody = await new OpenAITransformer().transformRequestIn(structuredClone(unified), { name: "openai", baseUrl: "https://api.openai.com/v1" } as any, sessionCtx());
  assert.ok(Array.isArray((chatBody as any).messages));

  // Anthropic → Gemini (googleSearch)
  const gemBody = buildGeminiBody(structuredClone(unified) as any, { name: "antigravity" } as any);
  assert.ok(Array.isArray(gemBody.tools));
  assert.ok(gemBody.tools.some((t: any) => t.googleSearch), "web_search must become googleSearch for Gemini");

  // Anthropic → Mistral (via helper)
  const { buildRequestBody: buildMistral } = await import("../utils/mistral.util");
  const mistralBody = buildMistral(structuredClone(unified) as any, sessionCtx(), { name: "mistral" } as any);
  assert.ok(Array.isArray(mistralBody.messages));
}

async function testChatToAllOutbounds() {
  const unified = await toUnifiedFromChat();
  const respTf = new OpenAIResponsesTransformer();
  (respTf as any).logger = logger;
  const respBody = await respTf.transformRequestIn(structuredClone(unified), { name: "openai", baseUrl: "https://api.openai.com/v1" } as any, { req: { id: "matrix", sessionId: "matrix-session", log: logger, protocolContext: { protocol: "openai_chat_completions" } }, clientProtocol: "openai_chat_completions", protocolContext: { protocol: "openai_chat_completions" } } as any);
  assert.ok(((respBody as any).include || []).includes("reasoning.encrypted_content"), "Chat→Responses must request encrypted_content");

  const anthTf2 = new AnthropicTransformer();
  (anthTf2 as any).logger = logger;
  const anthBody2 = (await anthTf2.transformRequestIn(structuredClone(unified), { name: "anthropic", apiKey: "k", baseUrl: "https://api.anthropic.com", models: [] } as any, sessionCtx()) as any).body;
  assert.ok(Array.isArray(anthBody2.messages));

  const chatBody = await new OpenAITransformer().transformRequestIn(structuredClone(unified), { name: "deepseek", baseUrl: "https://api.deepseek.com/v1" } as any, sessionCtx());
  assert.ok(Array.isArray((chatBody as any).messages));
}

async function testResponsesToAllOutbounds() {
  const unified = await toUnifiedFromResponses();
  // Responses → Responses (client-driven, include preserved, no synthesis)
  const respTf = new OpenAIResponsesTransformer();
  (respTf as any).logger = logger;
  const respBody = await respTf.transformRequestIn(structuredClone(unified), { name: "openai", baseUrl: "https://api.openai.com/v1" } as any, { req: { id: "r", sessionId: "s", log: logger }, clientProtocol: "openai_responses", protocolContext: { protocol: "openai_responses" } } as any);
  // For native Responses client, include is preserved from inbound, not invented
  assert.ok(Array.isArray((respBody as any).input));
  // custom_tool must survive as function with input key
  assert.ok((respBody as any).input.some((i: any) => i.type === "custom_tool_call" || i.type === "function_call"));

  // Responses → Anthropic (encrypted_content stripped, web_search dropped or mapped)
  const anthTf3 = new AnthropicTransformer();
  (anthTf3 as any).logger = logger;
  const anthBody = (await anthTf3.transformRequestIn(structuredClone(unified), { name: "anthropic", apiKey: "k", baseUrl: "https://api.anthropic.com", models: [] } as any, sessionCtx()) as any).body;
  assert.equal(JSON.stringify(anthBody).includes("CIPHER_MATRIX"), false, "Responses encrypted_content must not leak to Anthropic");

  // Responses → Gemini (web_search → googleSearch, custom_tool → function)
  const gemBody = buildGeminiBody(structuredClone(unified) as any, { name: "antigravity" } as any);
  assert.ok(gemBody.tools.some((t: any) => t.googleSearch || t.functionDeclarations));

  // Responses → Codex (instructions fold, custom_tool preserved)
  const responsesTf = new OpenAIResponsesTransformer();
  (responsesTf as any).logger = logger;
  const responsesBody = await responsesTf.transformRequestIn(
    { ...structuredClone(unified), model: "gpt-5.6-sol", stream: false } as any,
    { name: "codex", baseUrl: "https://chatgpt.com/backend-api/codex", apiKey: "at-test", models: [] } as any,
    sessionCtx()
  );
  const codexTf = new CodexTransformer();
  (codexTf as any).logger = logger;
  (codexTf as any).resolveAuth = async () => ({ mode: "oauth", token: "t", accountId: "a", isFedramp: false });
  const codexBody = await codexTf.transformRequestIn(responsesBody as any, { name: "codex", baseUrl: "https://chatgpt.com/backend-api/codex", apiKey: "at-test", models: [] } as any, sessionCtx());
  assert.ok(Array.isArray((codexBody.body as any).input));
  assert.equal((codexBody.body as any).input.some((i: any) => i.role === "system"), false, "Codex must fold system into instructions");
}

async function testCallIdBoundsAcrossOutbounds() {
  const longId = "call-66dbf0b1-aad7-482f-baa2-647748651824-0_fc_49ff1230-042d-97ce-b451-5e3f019a21d8_0"; // 85 chars
  const unified: any = {
    model: "gpt-5",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [{ id: longId, type: "function", function: { name: "Read", arguments: "{}" } }] },
      { role: "tool", tool_call_id: longId, content: "ok" },
    ],
    tools: [{ type: "function", function: { name: "Read", parameters: { type: "object", properties: {} } } }],
  };
  const pat = /^[a-zA-Z0-9_-]{1,64}$/;
  for (const builder of [
    async () => (await new OpenAIResponsesTransformer().transformRequestIn(structuredClone(unified), {} as any, sessionCtx()) as any).input,
    async () => {
      const responses = await new OpenAIResponsesTransformer().transformRequestIn(
        { ...structuredClone(unified), model: "gpt-5.6-sol", stream: false } as any,
        {} as any,
        sessionCtx()
      );
      const tf = new CodexTransformer();
      (tf as any).logger = logger;
      (tf as any).resolveAuth = async () => ({ mode: "oauth", token: "t", accountId: "a", isFedramp: false });
      let b: any = await tf.transformRequestIn(responses as any, { name: "codex", baseUrl: "https://chatgpt.com/backend-api/codex", apiKey: "at-test", models: [] } as any, sessionCtx());
      if ((b as any).body && (b as any).body.input) b = (b as any).body;
      return (b as any).input || (b as any).body?.input;
    },
  ]) {
    const input = await builder();
    if (!input) continue;
    const call = input.find((i: any) => i.type === "function_call" || i.type === "custom_tool_call");
    const out = input.find((i: any) => i.type === "function_call_output" || i.type === "custom_tool_call_output");
    if (call && out) {
      assert.match(call.call_id, pat);
      assert.equal(call.call_id, out.call_id);
    }
  }
}

async function main() {
  await testToolSchemaMatrix();
  await testAnthropicToAllOutbounds();
  await testChatToAllOutbounds();
  await testResponsesToAllOutbounds();
  await testCallIdBoundsAcrossOutbounds();
  console.log("cross-protocol.matrix: PASS");
}

async function testToolSchemaMatrix() {
  let deep: any = { type: "string" };
  for (let i = 0; i < 9; i++) {
    deep = { type: "object", properties: { child: deep }, required: ["child"], additionalProperties: false };
  }
  const definitions = [
    { name: "Deep", parameters: deep, strict: false },
    { name: "Strict", parameters: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false }, strict: true },
    { name: "Edit", parameters: { type: "object", properties: { replacement: { type: "string" } }, required: ["replacement"] }, strict: false },
    { name: "WebSearch", parameters: { type: "object", properties: { allowed_domains: { type: "array", items: { type: "string" } } } }, strict: false },
    { name: "Default", parameters: { type: "object", properties: {} } },
  ].map((tool) => ({ description: "Synthetic tool", ...tool }));
  const inboundBodies: Record<string, any> = {
    messages: { model: "model", max_tokens: 64, messages: [{ role: "user", content: "hello" }], tools: definitions.map(({ parameters, ...tool }) => ({ ...tool, input_schema: parameters })) },
    chat: { model: "model", messages: [{ role: "user", content: "hello" }], tools: definitions.map((tool) => ({ type: "function", function: tool })) },
    responses: { model: "model", input: "hello", tools: definitions.map((tool) => ({ type: "function", ...tool })) },
  };
  const owners: Record<string, any> = {
    messages: new AnthropicTransformer(),
    chat: new OpenAITransformer(),
    responses: new OpenAIResponsesTransformer(),
  };
  const { buildRequestBody: buildMistral } = await import("../utils/mistral.util");
  const { buildRequestBody: buildVertexClaude, transformRequestOut: fromVertexClaude } = await import("../utils/vertex-claude.util");
  const { GroqTransformer } = await import("../transformer/groq.transformer");
  for (const [inbound, body] of Object.entries(inboundBodies)) {
    const snapshot = structuredClone(body);
    const unified = await owners[inbound].transformRequestOut(structuredClone(body), sessionCtx());
    assert.deepEqual(unified.tools.map((tool: any) => tool.function), definitions, `${inbound}: inbound schema/strict fidelity`);
    const responses = await new OpenAIResponsesTransformer().transformRequestIn(structuredClone(unified), {} as any, sessionCtx()) as any;
    const codex = new CodexTransformer();
    (codex as any).resolveAuth = async () => ({ mode: "oauth", token: "synthetic", accountId: "synthetic", isFedramp: false });
    const codexProvider = { name: "codex", baseUrl: "https://chatgpt.com/backend-api/codex", apiKey: "at-test" } as any;
    const codexResult = await codex.transformRequestIn({ ...structuredClone(responses), model: "matrix-standard" }, codexProvider, sessionCtx());
    const liteResult = await codex.transformRequestIn({ ...structuredClone(responses), model: "gpt-5.6-sol" }, codexProvider, sessionCtx());
    const liteTools = liteResult.body.input.find((item: any) => item.type === "additional_tools").tools.flatMap((tool: any) => tool.tools ?? [tool]);
    const outbounds: Record<string, any> = {
      chat: await new OpenAITransformer().transformRequestIn(structuredClone(unified), {} as any, sessionCtx()),
      responses,
      codex: codexResult.body,
      codexLite: { tools: liteTools },
      anthropic: (await new AnthropicTransformer().transformRequestIn(structuredClone(unified), {} as any, sessionCtx()) as any).body,
      vertexClaude: buildVertexClaude(structuredClone(unified)),
      groq: await new GroqTransformer().transformRequestIn(structuredClone(unified)),
      mistral: buildMistral(structuredClone(unified), sessionCtx(), {} as any),
    };
    for (const [outbound, emitted] of Object.entries(outbounds)) {
      assert.ok(emitted?.tools, `${inbound} → ${outbound}: tools emitted; keys=${Object.keys(emitted ?? {})}`);
      for (const expected of definitions) {
        const wireTool = emitted.tools.find((tool: any) => (tool.function?.name ?? tool.name) === expected.name);
        const tool = wireTool.function ?? wireTool;
        assert.deepEqual(tool.parameters ?? tool.input_schema, expected.parameters, `${inbound} → ${outbound}: ${expected.name} schema`);
        assert.equal(tool.strict, (expected as any).strict, `${inbound} → ${outbound}: ${expected.name} strict`);
        assert.equal(Object.hasOwn(tool, "strict"), Object.hasOwn(expected, "strict"), `${inbound} → ${outbound}: omitted strict stays omitted`);
      }
    }
    for (const model of ["gemini-test", "claude-test"]) {
      const gemini = buildGeminiBody({ ...structuredClone(unified), model }, { name: "antigravity" } as any);
      const tools = gemini.tools.flatMap((tool: any) => tool.functionDeclarations ?? []);
      let schema = tools.find((tool: any) => tool.name === "Deep").parameters;
      for (let i = 0; i < 9; i++) {
        assert.equal(schema.type.toLowerCase(), "object", `${inbound} → ${model}: nested object ${i} preserved`);
        schema = schema.properties.child;
      }
      assert.equal(schema.type.toLowerCase(), "string", `${inbound} → ${model}: deep leaf preserved`);
    }
    assert.deepEqual(body, snapshot, `${inbound}: caller unchanged`);
  }
  const referenceSchema = {
    type: "object", properties: { value: { $ref: "#/$defs/value" } },
    $defs: { value: { type: "string" } }, allOf: [{ required: ["value"] }],
  };
  const roundTrip = fromVertexClaude(buildVertexClaude({
    model: "claude-test", messages: [{ role: "user", content: "hello" }],
    tools: [{ type: "function", function: { name: "References", description: "Synthetic tool", parameters: referenceSchema, strict: false } }],
  } as any));
  assert.deepEqual(roundTrip.tools![0].function.parameters, referenceSchema, "Vertex Claude round trip retains root schema keywords");
  assert.equal(roundTrip.tools![0].function.strict, false);
  const nativeTool = buildVertexClaude({
    model: "claude-test", messages: [{ role: "user", content: "hello" }],
    tools: [{ name: "References", description: "Synthetic tool", input_schema: referenceSchema, strict: false }],
  } as any).tools![0];
  assert.deepEqual(nativeTool.input_schema, referenceSchema, "Vertex Claude still accepts normalized native tools");
  assert.equal(nativeTool.strict, false);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

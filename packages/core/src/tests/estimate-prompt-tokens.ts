import assert from "node:assert/strict";
import { estimateRequestPromptTokens, estimateTokens } from "../utils/estimate-prompt-tokens";

assert.equal(estimateTokens(0), 0);
assert.equal(estimateTokens(-1), 0);
assert.equal(estimateTokens(Infinity), 0);
assert.equal(estimateTokens(5), 2);
assert.equal(estimateRequestPromptTokens({ model: "test", messages: [] }), 0);

const request = {
  model: "test",
  system: "policy",
  messages: [
    { role: "user" as const, content: [{ type: "text", text: "question" }] },
    {
      role: "assistant" as const,
      content: null,
      thinking: { content: "plan" },
      reasoning_content: "reason",
      tool_calls: [{ id: "call_1", type: "function" as const, function: { name: "Read", arguments: "{}" } }],
    },
  ],
  tools: [{ type: "function" as const, function: { name: "Read", parameters: { type: "object", properties: {} } } }],
};
const before = structuredClone(request);
const expected = [
  request.system,
  JSON.stringify(request.messages[0].content),
  "", "plan", "reason",
  JSON.stringify(request.messages[1].tool_calls),
  JSON.stringify(request.tools),
].join("\n");
assert.equal(estimateRequestPromptTokens(request as any), Math.ceil(expected.length / 4));
assert.deepEqual(request, before);
console.log("estimate-prompt-tokens: ok");

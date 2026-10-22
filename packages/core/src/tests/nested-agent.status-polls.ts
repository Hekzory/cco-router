import assert from "node:assert/strict";
import { isHarnessStatusPollTurn } from "../utils/nested-agent";

const poll = "Describe your most recent action in 3-5 words";
assert.equal(isHarnessStatusPollTurn({ messages: [{ role: "user", content: poll }] }), true);
assert.equal(isHarnessStatusPollTurn({ input: [{ type: "message", role: "user", content: [{ type: "input_text", text: poll }] }] }), true);
assert.equal(isHarnessStatusPollTurn({ messages: [{ role: "user", content: [{ type: "text", text: poll }] }] }), true);
assert.equal(isHarnessStatusPollTurn({ messages: [{ role: "system", content: poll }, { role: "user", content: "continue" }] }), false);
assert.equal(isHarnessStatusPollTurn({ messages: [{ role: "user", content: poll }, { role: "assistant", content: "Checking tests" }, { role: "user", content: "continue" }] }), false);
assert.equal(isHarnessStatusPollTurn({ messages: [{ role: "user", content: "Check the router status" }] }), false);
assert.equal(isHarnessStatusPollTurn({}), false);
console.log("nested-agent.status-polls: ok");

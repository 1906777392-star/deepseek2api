import assert from "node:assert/strict";
import test from "node:test";

import { recoverLoginArguments } from "../src/services/openai-login-arguments.js";

test("recovers a user-provided password when DeepSeek emits login with empty arguments", () => {
  const calls = [{ id: "call_1", name: "login", argumentsText: "{}", input: {} }];
  const messages = [
    { role: "assistant", content: "请把密码发给我" },
    { role: "user", content: "DEADSEA" }
  ];
  const repaired = recoverLoginArguments(calls, messages);
  assert.deepEqual(JSON.parse(repaired[0].argumentsText), { password: "DEADSEA" });
});

test("does not treat a generic password statement as the password value", () => {
  const calls = [{ id: "call_1", name: "login", argumentsText: "{}", input: {} }];
  const repaired = recoverLoginArguments(calls, [{ role: "user", content: "这个就是密码" }]);
  assert.equal(repaired[0].argumentsText, "{}");
});

test("does not alter non-login tool calls", () => {
  const calls = [{ id: "call_1", name: "draw", argumentsText: "{}", input: {} }];
  const repaired = recoverLoginArguments(calls, [{ role: "user", content: "DEADSEA" }]);
  assert.deepEqual(repaired, calls);
});

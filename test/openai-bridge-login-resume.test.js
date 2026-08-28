import assert from "node:assert/strict";
import test from "node:test";
import { continuationPrompt } from "../src/services/openai-bridge.js";

test("successful login explicitly resumes the blocked tool flow", () => {
  const prompt = continuationPrompt([
    { role: "user", content: "继续画剩下的角色" },
    { role: "assistant", tool_calls: [{ id: "draw-1", type: "function", function: { name: "draw", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "draw-1", name: "draw", content: "还没有登录，请提供密码。" },
    { role: "user", content: "example-password" },
    { role: "assistant", tool_calls: [{ id: "login-1", type: "function", function: { name: "login", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "login-1", name: "login", content: { message: "已登录", token_2: "secret-token" } }
  ], "ignored", { sessionId: "session" });

  assert.match(prompt, /登录已经成功/);
  assert.match(prompt, /恢复并继续执行登录前最近一次/);
  assert.match(prompt, /draw/);
});

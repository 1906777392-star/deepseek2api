import assert from "node:assert/strict";
import test from "node:test";

import { continuationPrompt } from "../src/services/openai-bridge.js";

const lineage = { sessionId: "session-1", parentMessageId: "message-1" };
const suppliedPassword = "example-password-4821";

test("user follow-up keeps the latest tool result from the same interaction", () => {
  const messages = [
    { role: "user", content: "画一个萝莉" },
    {
      role: "assistant",
      tool_calls: [{ id: "call_draw", type: "function", function: { name: "draw", arguments: "{}" } }]
    },
    {
      role: "tool",
      tool_call_id: "call_draw",
      content: "没做成：还没有登录。请先调用 login，并让使用者本人提供密码。"
    },
    { role: "assistant", content: "要开始画图需要先登录，请把密码发给我。" },
    { role: "user", content: suppliedPassword }
  ];

  const prompt = continuationPrompt(messages, "FULL PROMPT", lineage);
  assert.match(prompt, /TOOL: Tool result for draw:/);
  assert.match(prompt, /还没有登录/);
  assert.match(prompt, new RegExp(`USER: ${suppliedPassword}`));
  assert.match(prompt, /ASSISTANT:$/);
});

test("ordinary user continuation remains incremental when no tool result occurred", () => {
  const messages = [
    { role: "user", content: "你好" },
    { role: "assistant", content: "你好。" },
    { role: "user", content: "继续" }
  ];

  assert.equal(continuationPrompt(messages, "FULL PROMPT", lineage), "USER: 继续\n\nASSISTANT:");
});

test("requests without stored lineage still use the complete prompt", () => {
  assert.equal(
    continuationPrompt([{ role: "user", content: suppliedPassword }], "FULL PROMPT", null),
    "FULL PROMPT"
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { continuationPrompt } from "../src/services/openai-bridge.js";

const lineage = { sessionId: "session-1", parentMessageId: "message-1" };

test("persistent lineage no longer changes the complete prompt", () => {
  const messages = [
    { role: "system", content: "You are a general assistant." },
    { role: "user", content: "画一个萝莉" },
    { role: "assistant", content: "已经画好了。" },
    { role: "user", content: "继续" }
  ];

  assert.equal(continuationPrompt(messages, "FULL PROMPT", lineage), "FULL PROMPT");
  assert.equal(continuationPrompt(messages, "FULL PROMPT", null), "FULL PROMPT");
});

test("tool results remain part of the full client history instead of synthetic continuation text", () => {
  const messages = [
    { role: "user", content: "画一只小萝莉" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_draw", type: "function", function: { name: "draw", arguments: "{\\"count\\":1}" } }] },
    { role: "tool", tool_call_id: "call_draw", content: "图片已生成" },
    { role: "user", content: "好看吗" }
  ];

  assert.equal(continuationPrompt(messages, "FULL PROMPT", lineage), "FULL PROMPT");
});

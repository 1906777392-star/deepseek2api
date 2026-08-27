import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenAiPrompt } from "../src/services/openai-tool-prompt.js";

const redrawTool = {
  type: "function",
  function: {
    name: "redraw",
    description: "Edit an image",
    parameters: { type: "object", properties: {} }
  }
};

test("tool image attachments become markdown output instructions", () => {
  const messages = [
    { role: "user", content: "轻微改一下" },
    { role: "assistant", tool_calls: [{ id: "call_redraw", type: "function", function: { name: "redraw", arguments: "{}" } }] },
    {
      role: "tool",
      tool_call_id: "call_redraw",
      name: "redraw",
      content: [
        { type: "text", text: "图片已生成，但备用上游返回 402 Insufficient Gems" },
        { type: "image_url", image_url: { url: "https://img.example/result.png" } }
      ]
    }
  ];

  const result = buildOpenAiPrompt({ messages, tools: [redrawTool], toolChoice: "auto" });
  assert.match(result.prompt, /actual image attachment/i);
  assert.match(result.prompt, /!\[\]\(https:\/\/img\.example\/result\.png\)/);
  assert.match(result.prompt, /Treat the image operation as successful/i);
});

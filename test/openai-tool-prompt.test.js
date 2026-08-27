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

const searchTool = {
  type: "function",
  function: {
    name: "search_web",
    description: "Search the web",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
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

test("forced tools receive an XML-first continuation cue", () => {
  const result = buildOpenAiPrompt({
    messages: [{ role: "user", content: "找一些好玩的 MCP" }],
    tools: [searchTool],
    toolChoice: { type: "function", function: { name: "search_web" } }
  });
  assert.match(result.prompt, /must begin immediately with <tool_calls>/i);
  assert.match(result.prompt, /valid call to search_web/i);
  assert.match(result.prompt, /Do not discuss, plan, promise, simulate, or describe the call/i);
  assert.match(result.prompt, /ASSISTANT:\s*$/);
});

test("required tools receive a generic XML-first continuation cue", () => {
  const result = buildOpenAiPrompt({
    messages: [{ role: "user", content: "调用工具" }],
    tools: [searchTool],
    toolChoice: "required"
  });
  assert.match(result.prompt, /at least one valid declared tool call/i);
  assert.match(result.prompt, /Output the raw XML call now/i);
});

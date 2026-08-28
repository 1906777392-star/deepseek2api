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

const loginTool = {
  type: "function",
  function: {
    name: "login",
    description: "Login with the password supplied by the user",
    parameters: {
      type: "object",
      properties: { password: { type: "string" }, invite_code: { type: "string" } },
      required: ["password", "invite_code"]
    }
  }
};

test("historical tool image attachments are not replayed as current prompt images", () => {
  const messages = [
    { role: "user", content: "轻微改一下" },
    { role: "assistant", tool_calls: [{ id: "call_redraw", type: "function", function: { name: "redraw", arguments: "{}" } }] },
    {
      role: "tool",
      tool_call_id: "call_redraw",
      name: "redraw",
      content: [
        { type: "text", text: "图片已生成" },
        { type: "image_url", image_url: { url: "https://img.example/result.png" } }
      ]
    },
    { role: "user", content: "这次不要看图，直接告诉我下一步" }
  ];

  const result = buildOpenAiPrompt({ messages, tools: [redrawTool], toolChoice: "auto" });
  assert.doesNotMatch(result.prompt, /!\[\]\(https:\/\/img\.example\/result\.png\)/);
  assert.match(result.prompt, /historical turn|previous image attachment omitted/i);
  assert.match(result.prompt, /图片已生成/);
});

test("current user image is represented as a separate attachment, not markdown in the prompt", () => {
  const result = buildOpenAiPrompt({
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "请看这张图" },
        { type: "image_url", image_url: { url: "https://img.example/current.png" } }
      ]
    }],
    tools: [redrawTool],
    toolChoice: "auto"
  });

  assert.match(result.prompt, /请看这张图/);
  assert.match(result.prompt, /attached to this current user turn/i);
  assert.doesNotMatch(result.prompt, /!\[\]\(https:\/\/img\.example\/current\.png\)/);
});

test("tool prompt identifies Kelivo and keeps secrets inside required tool parameters", () => {
  const result = buildOpenAiPrompt({
    messages: [{ role: "user", content: "这个就是密码" }],
    tools: [loginTool, redrawTool],
    toolChoice: "auto"
  });
  assert.match(result.prompt, /operating inside Kelivo/i);
  assert.match(result.prompt, /pass it only inside that tool's required parameter/i);
  assert.match(result.prompt, /call the same tool again with the supplied value/i);
  assert.match(result.prompt, /Do not switch to an unrelated tool/i);
  assert.match(result.prompt, /never replace a known value with an empty object/i);
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

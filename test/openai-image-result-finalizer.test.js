import assert from "node:assert/strict";
import test from "node:test";

import { formatCompletedImageToolResult, latestCompletedImageToolResult } from "../src/services/openai-image-result-finalizer.js";

test("the last successful image tool result is finalized without another model turn", () => {
  const messages = [
    { role: "user", content: "再画一张" },
    { role: "assistant", tool_calls: [{ id: "call_draw", type: "function", function: { name: "draw", arguments: "{}" } }] },
    {
      role: "tool",
      tool_call_id: "call_draw",
      name: "draw",
      content: [
        { type: "text", text: "图片已生成，但备用线路返回 402" },
        { type: "image_url", image_url: { url: "https://img.example/result.png" } }
      ]
    }
  ];
  const result = latestCompletedImageToolResult(messages);
  assert.deepEqual(result, { name: "draw", imageUrls: ["https://img.example/result.png"] });
  assert.equal(formatCompletedImageToolResult(result), "已经完成。\n\n![](https://img.example/result.png)");
});

test("an authentication request from character_save is finalized directly", () => {
  const messages = [
    { role: "assistant", tool_calls: [{ id: "call_save", type: "function", function: { name: "character_save", arguments: "{}" } }] },
    {
      role: "tool",
      tool_call_id: "call_save",
      name: "character_save",
      content: "请把登录码填进来，就是登录时给你的那一串。如果使用者只给了密码，就直接用密码调登录。"
    }
  ];

  const result = latestCompletedImageToolResult(messages);
  assert.deepEqual(result, {
    name: "auth_input",
    imageUrls: [],
    content: "还没有登录。把喵绘密码发给我；如果你已经有登录码，也可以直接发登录码。"
  });
  assert.equal(formatCompletedImageToolResult(result), result.content);
});

test("ordinary Miaohui action results are returned directly", () => {
  const messages = [
    { role: "assistant", tool_calls: [{ id: "call_save", type: "function", function: { name: "character_save", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_save", content: "角色“白丝小萝莉”已经存入档案。" }
  ];

  const result = latestCompletedImageToolResult(messages);
  assert.deepEqual(result, {
    name: "character_save",
    imageUrls: [],
    content: "角色“白丝小萝莉”已经存入档案。"
  });
});

test("sensitive login values are hidden from direct tool output", () => {
  const messages = [
    { role: "assistant", tool_calls: [{ id: "call_login", type: "function", function: { name: "login", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_login", content: { message: "登录成功", token_2: "secret-login-token" } }
  ];

  const result = latestCompletedImageToolResult(messages);
  assert.match(result.content, /登录成功/);
  assert.doesNotMatch(result.content, /secret-login-token/);
  assert.match(result.content, /\[已隐藏\]/);
});

test("view_image remains available for a model-authored visual judgment", () => {
  const messages = [
    { role: "assistant", tool_calls: [{ id: "call_view", type: "function", function: { name: "view_image", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_view", content: "图片读取完成" }
  ];
  assert.equal(latestCompletedImageToolResult(messages), null);
});

test("unrelated API tools are not intercepted", () => {
  const messages = [
    { role: "assistant", tool_calls: [{ id: "call_issue", type: "function", function: { name: "issue_read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_issue", content: "issue data" }
  ];
  assert.equal(latestCompletedImageToolResult(messages), null);
});

test("a later user message prevents stale tool-result finalization", () => {
  const messages = [
    { role: "assistant", tool_calls: [{ id: "call_draw", type: "function", function: { name: "draw", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_draw", name: "draw", content: "![](https://img.example/result.png)" },
    { role: "user", content: "这张哪里不对" }
  ];
  assert.equal(latestCompletedImageToolResult(messages), null);
});

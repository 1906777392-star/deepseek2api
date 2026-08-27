import assert from "node:assert/strict";
import test from "node:test";

import { extractLatestUserImageContext } from "../src/services/openai-image-input.js";

test("only the latest user message contributes image inputs", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "旧图" }, { type: "image_url", image_url: { url: "data:image/png;base64,OLD" } }] },
    { role: "assistant", content: "看过了" },
    { role: "user", content: "这是什么密码" }
  ];
  assert.deepEqual(extractLatestUserImageContext(messages), { imageInputs: [], userText: "这是什么密码" });
});

test("latest user images and accompanying text are preserved", () => {
  const messages = [
    { role: "user", content: "旧问题" },
    { role: "user", content: [{ type: "text", text: "看这张图后帮我处理" }, { type: "image_url", image_url: { url: "https://example.com/current.png", detail: "high" } }] }
  ];
  assert.deepEqual(extractLatestUserImageContext(messages), { imageInputs: [{ url: "https://example.com/current.png", detail: "high" }], userText: "看这张图后帮我处理" });
});

test("assistant or tool result images moved onto a new generation request are not treated as uploads", () => {
  const messages = [
    { role: "user", content: "画一张图" },
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "draw", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_1", name: "draw", content: "图片已生成。\n![](https://img.example/generated.png)" },
    { role: "user", content: [{ type: "text", text: "再画一张她吃东西的图" }, { type: "image_url", image_url: { url: "https://img.example/generated.png" } }] }
  ];
  assert.deepEqual(extractLatestUserImageContext(messages), { imageInputs: [], userText: "再画一张她吃东西的图" });
});

test("replayed assistant images are restored when the user explicitly asks to inspect them", () => {
  const messages = [
    { role: "user", content: "画一张图" },
    { role: "assistant", content: "已经画好。\n![](https://img.example/generated.png)" },
    { role: "user", content: [{ type: "text", text: "你不知道自己想办法看吗" }, { type: "image_url", image_url: { url: "https://img.example/generated.png", detail: "high" } }] }
  ];
  assert.deepEqual(extractLatestUserImageContext(messages), {
    imageInputs: [{ url: "https://img.example/generated.png", detail: "high" }],
    userText: "你不知道自己想办法看吗"
  });
});

test("short confirmation reuses images when the prior assistant proposed image inspection", () => {
  const messages = [
    { role: "assistant", content: "我可以调用 view_image 查看图片。\n![](https://img.example/generated.png)" },
    { role: "user", content: [{ type: "text", text: "你试试" }, { type: "image_url", image_url: { url: "https://img.example/generated.png" } }] }
  ];
  assert.deepEqual(extractLatestUserImageContext(messages), {
    imageInputs: [{ url: "https://img.example/generated.png", detail: "auto" }],
    userText: "你试试"
  });
});

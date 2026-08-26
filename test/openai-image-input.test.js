import assert from "node:assert/strict";
import test from "node:test";

import { extractLatestUserImageContext } from "../src/services/openai-image-input.js";

test("only the latest user message contributes image inputs", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "旧图" }, { type: "image_url", image_url: { url: "data:image/png;base64,OLD" } }] },
    { role: "assistant", content: "看过了" },
    { role: "user", content: "这是什么密码" }
  ];

  assert.deepEqual(extractLatestUserImageContext(messages), {
    imageInputs: [],
    userText: "这是什么密码"
  });
});

test("latest user images and accompanying text are preserved", () => {
  const messages = [
    { role: "user", content: "旧问题" },
    {
      role: "user",
      content: [
        { type: "text", text: "看这张图后帮我处理" },
        { type: "image_url", image_url: { url: "https://example.com/current.png", detail: "high" } }
      ]
    }
  ];

  assert.deepEqual(extractLatestUserImageContext(messages), {
    imageInputs: [{ url: "https://example.com/current.png", detail: "high" }],
    userText: "看这张图后帮我处理"
  });
});

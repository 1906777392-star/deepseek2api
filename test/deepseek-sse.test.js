import { createDeepseekDeltaDecoder, createSseParser } from "../src/utils/deepseek-sse.js";
import assert from "node:assert/strict";
import test from "node:test";

test("vision fragment aliases decode as response text", () => {
  const decoder = createDeepseekDeltaDecoder();
  const delta = decoder.consume(JSON.stringify({
    p: "response/fragments",
    o: "SET",
    v: [{ type: "VISION_RESPONSE", content: "这是一名粉发角色。" }]
  }));

  assert.deepEqual(delta, { kind: "response", text: "这是一名粉发角色。" });
});

test("unknown textual vision fragments fail open as response text", () => {
  const decoder = createDeepseekDeltaDecoder();
  const delta = decoder.consume(JSON.stringify({
    p: "response/fragments",
    o: "SET",
    v: [{ type: "MULTIMODAL_TEXT", content: "图片内容已识别。" }]
  }));

  assert.deepEqual(delta, { kind: "response", text: "图片内容已识别。" });
});

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

test("a later user message prevents stale image-result finalization", () => {
  const messages = [
    { role: "assistant", tool_calls: [{ id: "call_draw", type: "function", function: { name: "draw", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_draw", name: "draw", content: "![](https://img.example/result.png)" },
    { role: "user", content: "这张哪里不对" }
  ];
  assert.equal(latestCompletedImageToolResult(messages), null);
});

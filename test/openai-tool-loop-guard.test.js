import assert from "node:assert/strict";
import test from "node:test";

import { blockedToolNamesForRequest, completedToolNamesSinceLatestUser, filterToolsForRequest, hasPendingJobContext, limitImageGenerationCalls } from "../src/services/openai-tool-loop-guard.js";

const tools = ["draw", "redraw", "view_image", "check_job", "create_memory"].map((name) => ({ type: "function", function: { name, parameters: { type: "object" } } }));

test("successful tool results block image regeneration and check_job in one user turn", () => {
  const messages = [
    { role: "user", content: "画图" },
    { role: "assistant", tool_calls: [{ id: "call_draw", type: "function", function: { name: "draw", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_draw", name: "draw", content: "图片已生成。\n![](https://img.example/a.png)" }
  ];
  assert.deepEqual([...completedToolNamesSinceLatestUser(messages)], ["draw"]);
  const blocked = blockedToolNamesForRequest(messages);
  assert.equal(blocked.has("draw"), true);
  assert.equal(blocked.has("redraw"), true);
  assert.equal(blocked.has("check_job"), true);
  assert.equal(blocked.has("view_image"), false);
  assert.deepEqual(filterToolsForRequest(tools, messages).map((tool) => tool.function.name), ["view_image", "create_memory"]);
});

test("check_job is hidden until a real pending task code exists", () => {
  const fresh = [{ role: "user", content: "画两张猫" }];
  assert.equal(hasPendingJobContext(fresh), false);
  assert.equal(filterToolsForRequest(tools, fresh).some((tool) => tool.function.name === "check_job"), false);

  const pending = [
    ...fresh,
    { role: "assistant", tool_calls: [{ id: "call_draw", type: "function", function: { name: "draw", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_draw", name: "draw", content: "任务码：A1B2C\n当前状态：还在画。" }
  ];
  assert.equal(hasPendingJobContext(pending), true);
  assert.equal(filterToolsForRequest(tools, pending).some((tool) => tool.function.name === "check_job"), true);
});

test("image attachment proves success even when result text contains a fallback quota error", () => {
  const messages = [
    { role: "user", content: "轻微重绘" },
    { role: "assistant", tool_calls: [{ id: "call_redraw", type: "function", function: { name: "redraw", arguments: "{}" } }] },
    {
      role: "tool",
      tool_call_id: "call_redraw",
      name: "redraw",
      content: [
        { type: "text", text: "图片已生成。（公益站未用：no credit left (402) - Insufficient Gems balance）" },
        { type: "image_url", image_url: { url: "https://img.example/redrawn.png" } }
      ]
    }
  ];
  const blocked = blockedToolNamesForRequest(messages);
  assert.equal(blocked.has("redraw"), true);
  assert.equal(blocked.has("draw"), true);
  assert.equal(blocked.has("check_job"), true);
});

test("after one image inspection the same view tool is blocked but final answering remains possible", () => {
  const messages = [
    { role: "user", content: "画图并检查" },
    { role: "assistant", tool_calls: [{ id: "call_draw", type: "function", function: { name: "draw", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_draw", name: "draw", content: "图片已生成。" },
    { role: "assistant", tool_calls: [{ id: "call_view", type: "function", function: { name: "view_image", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_view", name: "view_image", content: "这是那张图本身。" }
  ];
  const blocked = blockedToolNamesForRequest(messages);
  assert.equal(blocked.has("draw"), true);
  assert.equal(blocked.has("view_image"), true);
});

test("a new user turn resets the tool guard", () => {
  const messages = [
    { role: "user", content: "画第一张" },
    { role: "assistant", tool_calls: [{ id: "call_draw", type: "function", function: { name: "draw", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_draw", name: "draw", content: "图片已生成。" },
    { role: "assistant", content: "已经画好。" },
    { role: "user", content: "再画一张" }
  ];
  assert.deepEqual([...blockedToolNamesForRequest(messages)], []);
});

test("one model response can expose at most one image-generation call", () => {
  const calls = [{ name: "draw" }, { name: "redraw" }, { name: "view_image" }];
  assert.deepEqual(limitImageGenerationCalls(calls).map((call) => call.name), ["draw", "view_image"]);
});

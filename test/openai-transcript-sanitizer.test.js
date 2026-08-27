import assert from "node:assert/strict";
import test from "node:test";

import { createTranscriptLeakRouter, splitLeakedTranscript } from "../src/services/openai-transcript-sanitizer.js";

const leaked = [
  "正常开头。",
  "",
  "TOOL: Tool result for view_image:",
  "图片内容已加载，无法在文本中展示。",
  "",
  "TOOL: Tool result for view_image:",
  "图片内容已加载，无法在文本中展示。",
  "",
  "ASSISTANT: 我看了这两张图，第二张构图发生了变化。",
  "",
  "问题出在 redraw 会重新生成整张图。"
].join("\n");

test("non-stream output removes tool transcript and moves echoed assistant analysis to reasoning", () => {
  assert.deepEqual(splitLeakedTranscript(leaked), {
    visible: "正常开头。\n\n问题出在 redraw 会重新生成整张图。",
    reasoning: "我看了这两张图，第二张构图发生了变化。\n"
  });
});

test("stream router handles transcript markers split across chunks", () => {
  const router = createTranscriptLeakRouter();
  const events = [
    ...router.push("正常开头。\nTO"),
    ...router.push("OL: Tool result for view_image:\n图片已加载。\n\nASSISTANT: 内部判断。\n"),
    ...router.push("\n最终回答。"),
    ...router.flush()
  ];
  assert.equal(events.filter((event) => event.kind === "response").map((event) => event.text).join(""), "正常开头。\n最终回答。");
  assert.equal(events.filter((event) => event.kind === "thinking").map((event) => event.text).join(""), "内部判断。\n");
});

import assert from "node:assert/strict";
import test from "node:test";
import { createAiDisclaimerFilter, stripAiGeneratedDisclaimer } from "../src/services/openai-transcript-sanitizer.js";

test("strips DeepSeek AI disclaimer only from the response suffix", () => {
  assert.equal(stripAiGeneratedDisclaimer("正文。本回答由 AI 生成，内容仅供参考，请仔细甄别"), "正文。");
  assert.equal(stripAiGeneratedDisclaimer("正文。内容由 AI 生成，请仔细甄别"), "正文。");
});

test("stream filter catches a disclaimer split across chunks", () => {
  let output = "";
  const filter = createAiDisclaimerFilter((text) => { output += text; });
  filter.push("正文。本回");
  filter.push("答由 AI 生成，内容仅供参考，");
  filter.push("请仔细甄别");
  filter.flush();
  assert.equal(output, "正文。");
});

test("stream filter preserves ordinary text", () => {
  let output = "";
  const filter = createAiDisclaimerFilter((text) => { output += text; });
  filter.push("这是一段正常回复。");
  filter.flush();
  assert.equal(output, "这是一段正常回复。");
});

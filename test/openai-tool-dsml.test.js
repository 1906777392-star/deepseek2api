import assert from "node:assert/strict";
import test from "node:test";

import { parseToolCallsFromText } from "../src/services/openai-tool-parser.js";
import { createToolSieve, extractToolAwareOutput } from "../src/services/openai-tool-sieve.js";

const DSML_DRAW = [
  "<|DSML|tool_calls>",
  '<|DSML|invoke name="draw">',
  '<parameters><![CDATA[{"english_visual_description":"1girl, full body","coherence_checked":true,"token_2":"temporary-code"}]]></parameters>',
  "</invoke>"
].join("\n");

const FENCED_CHARACTER_SAVE = [
  "```json",
  "<tool_calls>",
  "  <tool_call>",
  "    <tool_name>character_save</tool_name>",
  '    <parameters><![CDATA[{"name":"双马尾萝莉","image":"https://example.com/a.png","appearance":"pink twin tails"}]]></parameters>',
  "  </tool_call>",
  "</tool_calls>",
  "```"
].join("\n");

const DIRECT_DRAW_TAG = [
  "<tool_calls>",
  "<tool_call>",
  "<draw>",
  '<parameters>{"english_visual_description":"1girl, petite, twin tails","coherence_checked":true,"avoid":"watermark","count":1}</parameters>',
  "</tool_call>",
  "</tool_calls>"
].join("\n");

test("parses DSML invoke attributes and CDATA JSON", () => {
  const calls = parseToolCallsFromText(DSML_DRAW, ["draw"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "draw");
  assert.equal(calls[0].input.english_visual_description, "1girl, full body");
  assert.equal(calls[0].input.coherence_checked, true);
  assert.equal(calls[0].input.token_2, "temporary-code");
});

test("parses a declared tool written directly as the first tool_call tag", () => {
  const calls = parseToolCallsFromText(DIRECT_DRAW_TAG, ["draw"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "draw");
  assert.equal(calls[0].input.english_visual_description, "1girl, petite, twin tails");
  assert.equal(calls[0].input.coherence_checked, true);
  assert.equal(calls[0].input.count, 1);
});

test("stream sieve emits a direct declared tool-name tag as a tool call", () => {
  const parsed = extractToolAwareOutput(DIRECT_DRAW_TAG, ["draw"]);
  assert.equal(parsed.content, "");
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].name, "draw");
});

test("direct tags that are not declared tools remain rejected", () => {
  const calls = parseToolCallsFromText(DIRECT_DRAW_TAG.replace("<draw>", "<unknown_tool>"), ["draw"]);
  assert.deepEqual(calls, []);
});

test("stream sieve removes a split DSML wrapper and emits one tool call", () => {
  const sieve = createToolSieve(["draw"]);
  const events = [
    ...sieve.push("前文<|DS"),
    ...sieve.push("ML|tool_calls>\n<|DSML|inv"),
    ...sieve.push('oke name="draw"><parameters><![CDATA[{"count":1,"aspect_2":"竖图"}]]></parameters>'),
    ...sieve.push("</invoke>后文"),
    ...sieve.flush()
  ];
  const text = events.filter((event) => event.type === "text").map((event) => event.text).join("");
  const calls = events.flatMap((event) => event.type === "tool_calls" ? event.calls : []);
  assert.equal(text, "前文后文");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "draw");
  assert.deepEqual(calls[0].input, { count: 1, aspect_2: "竖图" });
});

test("one sieve joins a tool call split between reasoning and answer channels", () => {
  const sieve = createToolSieve(["draw"]);
  const events = [
    ...sieve.push('先判断画面。<tool_call><tool_name>draw</tool_name>'),
    ...sieve.push('<parameters><![CDATA[{"count":1,"token_2":"secret-code"}]]></parameters></tool_call>'),
    ...sieve.flush()
  ];
  const text = events.filter((event) => event.type === "text").map((event) => event.text).join("");
  const calls = events.flatMap((event) => event.type === "tool_calls" ? event.calls : []);
  assert.equal(text, "先判断画面。");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "draw");
  assert.deepEqual(calls[0].input, { count: 1, token_2: "secret-code" });
});

test("tool-only json fence is treated as a real tool call", () => {
  const parsed = extractToolAwareOutput(FENCED_CHARACTER_SAVE, ["character_save"]);
  assert.equal(parsed.content, "");
  assert.equal(parsed.toolCalls.length, 1);
  assert.equal(parsed.toolCalls[0].name, "character_save");
  assert.equal(parsed.toolCalls[0].input.name, "双马尾萝莉");
});

test("split streaming fence is held until the tool call arrives", () => {
  const sieve = createToolSieve(["character_save"]);
  const events = [
    ...sieve.push("好的。\n```json\n"),
    ...sieve.push("<tool_calls><tool_call><tool_name>character_save</tool_name>"),
    ...sieve.push('<parameters>{"name":"双马尾萝莉","image":"https://example.com/a.png","appearance":"pink twin tails"}</parameters></tool_call></tool_calls>\n```'),
    ...sieve.flush()
  ];
  const text = events.filter((event) => event.type === "text").map((event) => event.text).join("");
  const calls = events.flatMap((event) => event.type === "tool_calls" ? event.calls : []);
  assert.equal(text, "好的。\n");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "character_save");
});

test("ordinary fenced XML discussion remains ordinary text", () => {
  const source = "```xml\nExample only: <tool_call><tool_name>draw</tool_name><parameters>{}</parameters></tool_call>\n```";
  const parsed = extractToolAwareOutput(source, ["draw"]);
  assert.equal(parsed.content, source);
  assert.deepEqual(parsed.toolCalls, []);
});

test("orphan parameter tail fails closed and never leaks credentials", () => {
  const parsed = extractToolAwareOutput('<parameters><![CDATA[{"token_2":"must-not-leak"}]]></parameters></tool_call>', ["draw"]);
  assert.equal(parsed.content, "");
  assert.deepEqual(parsed.toolCalls, []);
});

test("malformed unfinished DSML calls fail closed instead of leaking arguments", () => {
  const parsed = extractToolAwareOutput('正常文字<|DSML|invoke name="draw"><parameters>{"token_2":"must-not-leak"}', ["draw"]);
  assert.equal(parsed.content, "正常文字");
  assert.deepEqual(parsed.toolCalls, []);
});

test("fuzzy DSML wrapper residue is removed after a successful call", () => {
  const parsed = extractToolAwareOutput("已经看见。<| |DSML.| |tool_calls>", ["view_image"]);
  assert.equal(parsed.content, "已经看见。");
  assert.deepEqual(parsed.toolCalls, []);
});

test("duplicated fuzzy wrappers and an orphan tool name fail closed", () => {
  const parsed = extractToolAwareOutput("<| |DSML.| |tool_calls>\n<| |DSML.| |tool_calls>\n<tool_name>use_style</tool_name>", ["use_style"]);
  assert.equal(parsed.content, "");
  assert.deepEqual(parsed.toolCalls, []);
});

test("a fuzzy DSML tag split across stream chunks is held and removed", () => {
  const sieve = createToolSieve(["view_image"]);
  const events = [...sieve.push("正常文字<| |DSM"), ...sieve.push("L.| |tool_calls>"), ...sieve.flush()];
  const text = events.filter((event) => event.type === "text").map((event) => event.text).join("");
  assert.equal(text, "正常文字");
});

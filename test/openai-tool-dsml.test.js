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

test("parses DSML invoke attributes and CDATA JSON", () => {
  const calls = parseToolCallsFromText(DSML_DRAW, ["draw"]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "draw");
  assert.equal(calls[0].input.english_visual_description, "1girl, full body");
  assert.equal(calls[0].input.coherence_checked, true);
  assert.equal(calls[0].input.token_2, "temporary-code");
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

test("malformed unfinished DSML calls fail closed instead of leaking arguments", () => {
  const parsed = extractToolAwareOutput(
    '正常文字<|DSML|invoke name="draw"><parameters>{"token_2":"must-not-leak"}',
    ["draw"]
  );

  assert.equal(parsed.content, "正常文字");
  assert.deepEqual(parsed.toolCalls, []);
});

test("DSML-looking text inside a fenced code block remains ordinary text", () => {
  const source = '```xml\n<|DSML|invoke name="draw"><parameters>{}</parameters></invoke>\n```';
  const parsed = extractToolAwareOutput(source, ["draw"]);

  assert.equal(parsed.content, source);
  assert.deepEqual(parsed.toolCalls, []);
});

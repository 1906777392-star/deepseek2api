import assert from "node:assert/strict";
import test from "node:test";

import { inferToolChoiceForRequest } from "../src/services/openai-tool-choice-inference.js";

const tools = ["draw", "redraw", "character_reference", "view_image"].map((name) => ({
  type: "function",
  function: { name, parameters: { type: "object" } }
}));

const searchTools = ["firecrawl_search", "docs"].map((name) => ({
  type: "function",
  function: { name, parameters: { type: "object" } }
}));

test("再来一张 forces draw instead of vague required mode", () => {
  assert.deepEqual(inferToolChoiceForRequest([{ role: "user", content: "再来一张" }], tools, "auto"), {
    type: "function",
    function: { name: "draw" }
  });
});

test("explicit local edit forces redraw", () => {
  assert.deepEqual(inferToolChoiceForRequest([{ role: "user", content: "轻微改图" }], tools, "auto"), {
    type: "function",
    function: { name: "redraw" }
  });
});

test("explicit same-character scene change forces character_reference", () => {
  assert.deepEqual(inferToolChoiceForRequest([{ role: "user", content: "保持角色换场景再画一张" }], tools, "auto"), {
    type: "function",
    function: { name: "character_reference" }
  });
});

test("explicit MCP request requires a real tool call", () => {
  assert.equal(inferToolChoiceForRequest([{ role: "user", content: "调用呀" }], searchTools, "auto"), "required");
  assert.equal(inferToolChoiceForRequest([{ role: "user", content: "用 MCP 工具核实一下" }], searchTools, undefined), "required");
});

test("explicit search request requires a real tool call", () => {
  assert.equal(inferToolChoiceForRequest([{ role: "user", content: "搜一下有没有官方政策" }], searchTools, "auto"), "required");
});

test("MCP discovery and recommendation requests require a real tool call", () => {
  assert.equal(inferToolChoiceForRequest([{ role: "user", content: "找一些好玩的MCP" }], searchTools, "auto"), "required");
  assert.equal(inferToolChoiceForRequest([{ role: "user", content: "推荐几个实用的 MCP 服务器" }], searchTools, "auto"), "required");
  assert.equal(inferToolChoiceForRequest([{ role: "user", content: "有什么好玩的 MCP" }], searchTools, undefined), "required");
});

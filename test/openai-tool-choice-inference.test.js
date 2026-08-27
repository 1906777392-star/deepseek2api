import assert from "node:assert/strict";
import test from "node:test";

import { inferToolChoiceForRequest } from "../src/services/openai-tool-choice-inference.js";

const imageTools = ["draw", "redraw", "character_reference", "view_image"].map((name) => ({ type: "function", function: { name, parameters: { type: "object" } } }));
const searchTools = ["firecrawl_search", "docs", "create_memory"].map((name) => ({ type: "function", function: { name, parameters: { type: "object" } } }));
const genericTools = ["create_memory", "calendar_query"].map((name) => ({ type: "function", function: { name, parameters: { type: "object" } } }));

function forced(name) { return { type: "function", function: { name } }; }

test("short repeat-image requests force draw", () => assert.deepEqual(inferToolChoiceForRequest([{ role: "user", content: "再来一张" }], imageTools, "auto"), forced("draw")));
test("local image edits force redraw", () => assert.deepEqual(inferToolChoiceForRequest([{ role: "user", content: "轻微改图" }], imageTools, "auto"), forced("redraw")));
test("same-character scene changes force character_reference", () => assert.deepEqual(inferToolChoiceForRequest([{ role: "user", content: "保持角色换场景再画一张" }], imageTools, "auto"), forced("character_reference")));
test("MCP discovery chooses a concrete search tool", () => {
  assert.deepEqual(inferToolChoiceForRequest([{ role: "user", content: "找一些好玩的MCP" }], searchTools, "auto"), forced("firecrawl_search"));
  assert.deepEqual(inferToolChoiceForRequest([{ role: "user", content: "推荐几个实用的 MCP 服务器" }], searchTools, undefined), forced("firecrawl_search"));
  assert.deepEqual(inferToolChoiceForRequest([{ role: "user", content: "find some useful MCP tools" }], searchTools, "auto"), forced("firecrawl_search"));
});
test("explicit tool requests require a tool even without a search-named tool", () => {
  assert.equal(inferToolChoiceForRequest([{ role: "user", content: "调用呀" }], genericTools, "auto"), "required");
  assert.equal(inferToolChoiceForRequest([{ role: "user", content: "搜一下官方政策" }], genericTools, undefined), "required");
});
test("ordinary questions remain auto", () => {
  assert.equal(inferToolChoiceForRequest([{ role: "user", content: "MCP 是什么" }], searchTools, "auto"), "auto");
});

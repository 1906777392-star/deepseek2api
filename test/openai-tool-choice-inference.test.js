import assert from "node:assert/strict";
import test from "node:test";

import { inferToolChoiceForRequest } from "../src/services/openai-tool-choice-inference.js";

const tools = ["search_web", "draw", "create_memory"].map((name) => ({ type: "function", function: { name, parameters: { type: "object" } } }));
function forced(name) { return { type: "function", function: { name } }; }

function completedToolMessages() {
  return [
    { role: "user", content: "找一些好玩的 MCP" },
    { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "search_web", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_1", name: "search_web", content: "results" }
  ];
}

test("fresh requests stay auto regardless of search or image keywords", () => {
  assert.equal(inferToolChoiceForRequest([{ role: "user", content: "找一些好玩的 MCP" }], tools, "auto"), "auto");
  assert.equal(inferToolChoiceForRequest([{ role: "user", content: "画一张猫" }], tools, undefined), "auto");
  assert.equal(inferToolChoiceForRequest([{ role: "user", content: "我不想逆向" }], tools, "auto"), "auto");
});

test("an explicitly supplied forced choice is preserved on a fresh turn", () => {
  assert.deepEqual(inferToolChoiceForRequest([{ role: "user", content: "调用 search_web" }], tools, forced("search_web")), forced("search_web"));
});

test("tool results override stale required or forced choices from the client", () => {
  assert.equal(inferToolChoiceForRequest(completedToolMessages(), tools, "required"), "auto");
  assert.equal(inferToolChoiceForRequest(completedToolMessages(), tools, forced("search_web")), "auto");
});

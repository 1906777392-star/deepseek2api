import assert from "node:assert/strict";
import test from "node:test";

import { inferToolChoiceForRequest } from "../src/services/openai-tool-choice-inference.js";

const searchTools = ["search_web", "create_memory"].map((name) => ({ type: "function", function: { name, parameters: { type: "object" } } }));
function forced(name) { return { type: "function", function: { name } }; }

test("MCP discovery still forces a concrete search tool on a fresh user request", () => {
  assert.deepEqual(inferToolChoiceForRequest([{ role: "user", content: "找一些好玩的 MCP" }], searchTools, "auto"), forced("search_web"));
});

test("a tool result continues normally instead of forcing the same search again", () => {
  const messages = [
    { role: "user", content: "找一些好玩的 MCP" },
    { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "search_web", arguments: "{\"query\":\"fun MCP servers\"}" } }] },
    { role: "tool", tool_call_id: "call_1", name: "search_web", content: "search results" }
  ];
  assert.equal(inferToolChoiceForRequest(messages, searchTools, "auto"), "auto");
});

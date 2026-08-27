import assert from "node:assert/strict";
import test from "node:test";

import { repairToolCalls } from "../src/services/openai-tool-arguments.js";

const drawTool = {
  type: "function",
  function: {
    name: "draw",
    parameters: {
      type: "object",
      properties: {
        aspect_2: { type: "string", enum: ["竖图", "横图", "方图"] },
        count: { type: "integer" },
        token_2: { type: "string" },
        english_visual_description: { type: "string" },
        coherence_checked: { type: "boolean" }
      },
      required: ["aspect_2", "count", "token_2", "english_visual_description", "coherence_checked"]
    }
  }
};

const searchTool = {
  type: "function",
  function: {
    name: "search_web",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    }
  }
};

const deleteTool = {
  type: "function",
  function: {
    name: "delete_item",
    parameters: {
      type: "object",
      properties: { id: { type: "string" }, confirm: { type: "boolean" } },
      required: ["id", "confirm"]
    }
  }
};

test("repairs an empty draw call when the user delegates creative choices", () => {
  const messages = [
    { role: "tool", content: '{"token_2":"LOGIN123"}' },
    { role: "user", content: "随便你" }
  ];
  const result = repairToolCalls({ calls: [{ name: "draw", argumentsText: "{}" }], tools: [drawTool], messages });
  assert.equal(result.rejected.length, 0);
  assert.deepEqual(JSON.parse(result.calls[0].argumentsText), {
    aspect_2: "竖图",
    count: 1,
    token_2: "LOGIN123",
    english_visual_description: "1girl, full body, calm expression, standing in a quiet starlit field, flowing silver-white hair, dark elegant outfit, soft blue and silver moonlight, balanced composition, detailed atmospheric background",
    coherence_checked: true
  });
});

test("fills a single required string field from the latest user request", () => {
  const result = repairToolCalls({
    calls: [{ name: "search_web", argumentsText: "{}" }],
    tools: [searchTool],
    messages: [{ role: "user", content: "找一些好玩的 MCP" }]
  });
  assert.deepEqual(JSON.parse(result.calls[0].argumentsText), { query: "找一些好玩的 MCP" });
});

test("rejects unresolved multi-field calls instead of dispatching empty arguments", () => {
  const result = repairToolCalls({
    calls: [{ name: "delete_item", argumentsText: "{}" }],
    tools: [deleteTool],
    messages: [{ role: "user", content: "删掉它" }]
  });
  assert.equal(result.calls.length, 0);
  assert.deepEqual(result.rejected, [{ name: "delete_item", missing: ["id", "confirm"] }]);
});

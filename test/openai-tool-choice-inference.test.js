import assert from "node:assert/strict";
import test from "node:test";

import { inferToolChoiceForRequest } from "../src/services/openai-tool-choice-inference.js";

const tools = ["draw", "redraw", "character_reference", "view_image"].map((name) => ({
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

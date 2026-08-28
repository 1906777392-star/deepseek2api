import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenAiPrompt } from "../src/services/openai-tool-prompt.js";

const drawTool = {
  type: "function",
  function: {
    name: "draw",
    description: "Draw an image",
    parameters: { type: "object", properties: {} }
  }
};

test("image-heavy MCP tools remain optional capabilities rather than assistant identity", () => {
  const result = buildOpenAiPrompt({
    messages: [
      { role: "system", content: "You are a calm general assistant." },
      { role: "user", content: "在吗" }
    ],
    tools: [drawTool],
    toolChoice: "auto"
  });

  assert.match(result.prompt, /general-purpose assistant/i);
  assert.match(result.prompt, /optional capabilities, not your identity/i);
  assert.match(result.prompt, /Casual conversation and non-tool requests must be answered normally/i);
  assert.match(result.prompt, /USER: 在吗/);
});

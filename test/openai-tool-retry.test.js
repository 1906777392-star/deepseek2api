import assert from "node:assert/strict";
import test from "node:test";

import { buildToolArgumentCorrectionPrompt, buildToolCorrectionPrompt, createToolArgumentCorrectionRequest, createToolCorrectionRequest, isRequiredToolPolicy } from "../src/services/openai-tool-retry.js";

const model = { id: "deepseek-reasoner-expert", searchEnabled: true, thinkingEnabled: true };

test("hidden correction retry remains disabled when a tool call was omitted entirely", () => {
  assert.equal(isRequiredToolPolicy({ mode: "required" }), false);
  assert.equal(isRequiredToolPolicy({ mode: "forced" }), false);
  assert.equal(isRequiredToolPolicy({ mode: "auto" }), false);
});

test("legacy correction builder remains inert but safe", () => {
  const prompt = buildToolCorrectionPrompt({ mode: "forced", forcedName: "search_web" });
  assert.match(prompt, /search_web/);
  const corrected = createToolCorrectionRequest({ model, toolChoicePolicy: { mode: "forced", forcedName: "search_web" } }, { sessionId: "session", responseMessageId: "message" });
  assert.equal(corrected.sessionId, "session");
  assert.equal(corrected.parentMessageId, "message");
  assert.equal(corrected.model.searchEnabled, false);
});

test("argument correction tells the AI to generate parameters itself without bridge defaults", () => {
  const prompt = buildToolArgumentCorrectionPrompt("draw: english_visual_description is required");
  assert.match(prompt, /Rewrite the tool call yourself/);
  assert.match(prompt, /Choose all inferable creative\/default values yourself/);
  assert.match(prompt, /do not output \{\}/i);
  assert.doesNotMatch(prompt, /starlit field|silver-white hair/);
  const corrected = createToolArgumentCorrectionRequest({ model }, { sessionId: "session", responseMessageId: "message" }, "draw: missing");
  assert.equal(corrected.sessionId, "session");
  assert.equal(corrected.parentMessageId, "message");
  assert.equal(corrected.model.searchEnabled, false);
});

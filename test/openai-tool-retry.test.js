import assert from "node:assert/strict";
import test from "node:test";

import { buildToolCorrectionPrompt, createToolCorrectionRequest, isRequiredToolPolicy } from "../src/services/openai-tool-retry.js";

const model = { id: "deepseek-reasoner-expert", searchEnabled: true, thinkingEnabled: true };

test("hidden correction retry is disabled for required and forced policies", () => {
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

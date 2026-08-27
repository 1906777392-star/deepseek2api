import assert from "node:assert/strict";
import test from "node:test";

import { buildToolCorrectionPrompt, createToolCorrectionRequest, isRequiredToolPolicy } from "../src/services/openai-tool-retry.js";

const model = { id: "deepseek-reasoner-expert", searchEnabled: true, thinkingEnabled: true };

test("required and forced policies are buffered for correction", () => {
  assert.equal(isRequiredToolPolicy({ mode: "required" }), true);
  assert.equal(isRequiredToolPolicy({ mode: "forced" }), true);
  assert.equal(isRequiredToolPolicy({ mode: "auto" }), false);
});

test("forced correction names the exact declared tool and forbids internal browsing", () => {
  const prompt = buildToolCorrectionPrompt({ mode: "forced", forcedName: "search_web" });
  assert.match(prompt, /Call only the declared tool search_web/);
  assert.match(prompt, /Do not browse internally/);
  assert.match(prompt, /Return only one raw XML tool-call block/);
});

test("correction continues from the failed response and disables native search", () => {
  const corrected = createToolCorrectionRequest({
    model,
    prompt: "original",
    imageInputs: ["image"],
    refFileIds: ["file"],
    sessionId: "session-old",
    parentMessageId: "message-old",
    toolChoicePolicy: { mode: "forced", forcedName: "search_web" }
  }, {
    sessionId: "session-new",
    responseMessageId: "message-new"
  });

  assert.equal(corrected.sessionId, "session-new");
  assert.equal(corrected.parentMessageId, "message-new");
  assert.equal(corrected.model.searchEnabled, false);
  assert.deepEqual(corrected.imageInputs, []);
  assert.deepEqual(corrected.refFileIds, []);
  assert.match(corrected.prompt, /search_web/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { resolveOpenAiModel } from "../src/services/openai-request.js";

test("Expert models accept API image requests for mediated vision inspection", () => {
  const chatExpert = resolveOpenAiModel("deepseek-chat-expert");
  const reasonerExpert = resolveOpenAiModel("deepseek-reasoner-expert");

  assert.equal(chatExpert.supportsUploads, true);
  assert.equal(reasonerExpert.supportsUploads, true);
  assert.equal(chatExpert.vision, false);
  assert.equal(reasonerExpert.vision, false);
});

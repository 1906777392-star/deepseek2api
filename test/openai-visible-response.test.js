import assert from "node:assert/strict";
import test from "node:test";

import { EMPTY_VISIBLE_RESPONSE_MESSAGE, hasVisibleAssistantOutput } from "../src/services/openai-visible-response.js";

test("thinking alone is not considered a visible assistant response", () => {
  assert.equal(hasVisibleAssistantOutput("", []), false);
  assert.equal(hasVisibleAssistantOutput("   ", []), false);
  assert.equal(hasVisibleAssistantOutput("只在思考区", []), true);
  assert.equal(hasVisibleAssistantOutput("", [{ name: "draw" }]), true);
  assert.match(EMPTY_VISIBLE_RESPONSE_MESSAGE, /可见回复/);
});

import assert from "node:assert/strict";
import test from "node:test";

import { getConversationId } from "../src/services/conversation-service.js";

test("conversation identity prefers the Kelivo custom header", () => {
  assert.equal(getConversationId({ headers: { "x-kelivo-conversation-id": "kelivo-123" } }, {}), "kelivo-123");
});

test("conversation identity falls back to an explicit body field", () => {
  assert.equal(getConversationId({ headers: {} }, { conversation_id: "body-123" }), "body-123");
});

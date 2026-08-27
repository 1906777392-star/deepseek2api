import assert from "node:assert/strict";
import test from "node:test";
import { getConversationId } from "../src/services/conversation-service.js";
test("Kelivo's native conversation header is accepted", () => {
  assert.equal(getConversationId({ headers: { "x-conversation-id": "conv-1" } }, {}), "conv-1");
});

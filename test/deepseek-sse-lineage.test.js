import assert from "node:assert/strict";
import test from "node:test";
import { createDeepseekDeltaDecoder } from "../src/utils/deepseek-sse.js";
test("decoder captures response message id from ready payload", () => {
  const decoder = createDeepseekDeltaDecoder();
  decoder.consume(JSON.stringify({ response_message_id: "m-123" }));
  assert.equal(decoder.getResponseMessageId(), "m-123");
});

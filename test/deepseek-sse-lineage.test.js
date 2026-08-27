import assert from "node:assert/strict";
import test from "node:test";
import { createDeepseekDeltaDecoder } from "../src/utils/deepseek-sse.js";

test("decoder captures response message id from a path", () => {
  const decoder = createDeepseekDeltaDecoder();
  decoder.consume(JSON.stringify({ p: "response_message_id", o: "SET", v: "m-123" }));
  assert.equal(decoder.getResponseMessageId(), "m-123");
});

test("decoder captures response message id from a ready root payload", () => {
  const decoder = createDeepseekDeltaDecoder();
  decoder.consume(JSON.stringify({ response: { response_message_id: "m-456" } }));
  assert.equal(decoder.getResponseMessageId(), "m-456");
});

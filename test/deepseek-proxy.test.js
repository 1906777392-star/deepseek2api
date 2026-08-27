import assert from "node:assert/strict";
import test from "node:test";

import { isInvalidPowPayload } from "../src/services/deepseek-proxy.js";

test("detects DeepSeek invalid PoW responses in JSON and plain text", () => {
  assert.equal(isInvalidPowPayload('{"data":{"biz_msg":"INVALID_POW_RESPONSE"}}'), true);
  assert.equal(isInvalidPowPayload("DeepSeek completion failed: INVALID_POW_RESPONSE"), true);
  assert.equal(isInvalidPowPayload('{"data":{"biz_msg":"OK"}}'), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { API_KEY_ACCOUNT_MODES, normalizeApiKeyAccountMode } from "../src/services/api-key-service.js";

test("API key account mode defaults to fixed and only permits explicit round robin", () => {
  assert.equal(normalizeApiKeyAccountMode(undefined), API_KEY_ACCOUNT_MODES.FIXED);
  assert.equal(normalizeApiKeyAccountMode("anything"), API_KEY_ACCOUNT_MODES.FIXED);
  assert.equal(normalizeApiKeyAccountMode("round_robin"), API_KEY_ACCOUNT_MODES.ROUND_ROBIN);
});

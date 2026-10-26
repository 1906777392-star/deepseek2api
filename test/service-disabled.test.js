import test from "node:test";
import assert from "node:assert/strict";
import { respondServiceDisabled, shutdownRevision } from "../src/service-disabled.js";
import catchAll from "../api/[...path].js";
import models from "../api/models.js";
import v1 from "../api/v1/[...path].js";
import disabled from "../api/service-disabled.js";

for (const [name, handler] of Object.entries({ catchAll, models, v1, disabled })) {
  test(`${name}: every request is disabled without upstream access`, () => {
    for (const method of ["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD"]) {
      const headers = {};
      let body;
      const response = {
        statusCode: 0,
        setHeader(name, value) { headers[name] = value; },
        end(value) { body = value; }
      };
      handler({ method, url: "/v1/chat/completions" }, response);
      assert.equal(response.statusCode, 410);
      assert.equal(headers["x-deepseek2api-state"], shutdownRevision);
      assert.equal(headers["cache-control"], "no-store, max-age=0");
      if (method === "HEAD") assert.equal(body, undefined);
      else assert.equal(JSON.parse(body).error.code, "SERVICE_DISABLED");
    }
  });
}

test("disabled endpoint shares the same shutdown responder", () => {
  assert.equal(disabled, respondServiceDisabled);
});

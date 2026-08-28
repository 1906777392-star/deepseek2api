import assert from "node:assert/strict";
import test from "node:test";

import { validateToolCalls } from "../src/services/openai-tool-arguments.js";

const drawTool = {
  type: "function",
  function: {
    name: "draw",
    parameters: {
      type: "object",
      properties: {
        aspect_2: { type: "string", enum: ["竖图", "横图", "方图"] },
        count: { type: "integer" },
        token_2: { type: "string" },
        english_visual_description: { type: "string" },
        coherence_checked: { type: "boolean" }
      },
      required: ["aspect_2", "count", "token_2", "english_visual_description", "coherence_checked"]
    }
  }
};

const checkJobTool = {
  type: "function",
  function: {
    name: "check_job",
    parameters: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        token_2: { type: "string" }
      },
      required: ["job_id"]
    }
  }
};

test("empty tool arguments are rejected rather than filled by the bridge", () => {
  const result = validateToolCalls({ calls: [{ name: "draw", argumentsText: "{}" }], tools: [drawTool] });
  assert.equal(result.calls.length, 0);
  assert.match(result.rejected[0].issues.join(" "), /english_visual_description is required/);
  assert.doesNotMatch(JSON.stringify(result), /starlit field|silver-white hair/);
});

test("complete AI-generated arguments pass through unchanged", () => {
  const args = { aspect_2: "方图", count: 2, token_2: "LOGIN123", english_visual_description: "2cats, playing chess", coherence_checked: true };
  const result = validateToolCalls({ calls: [{ name: "draw", argumentsText: JSON.stringify(args) }], tools: [drawTool] });
  assert.equal(result.rejected.length, 0);
  assert.deepEqual(JSON.parse(result.calls[0].argumentsText), args);
});

test("wrong types and enum values are rejected", () => {
  const args = { aspect_2: "超宽图", count: "1", token_2: "LOGIN123", english_visual_description: "cat", coherence_checked: "yes" };
  const result = validateToolCalls({ calls: [{ name: "draw", argumentsText: JSON.stringify(args) }], tools: [drawTool] });
  const issues = result.rejected[0].issues.join(" ");
  assert.match(issues, /aspect_2 must be one of/);
  assert.match(issues, /count must be integer/);
  assert.match(issues, /coherence_checked must be boolean/);
});

test("a login token cannot be mistaken for a check_job task code", () => {
  const result = validateToolCalls({
    calls: [{ name: "check_job", argumentsText: JSON.stringify({ token_2: "HJCFM992" }) }],
    tools: [checkJobTool]
  });
  assert.equal(result.calls.length, 0);
  const issues = result.rejected[0].issues.join(" ");
  assert.match(issues, /job_id is required/);
  assert.match(issues, /real 5-character task code/);
});

test("check_job accepts the real five-character task code", () => {
  const args = { job_id: "A1B2C", token_2: "LOGIN123" };
  const result = validateToolCalls({ calls: [{ name: "check_job", argumentsText: JSON.stringify(args) }], tools: [checkJobTool] });
  assert.equal(result.rejected.length, 0);
  assert.deepEqual(JSON.parse(result.calls[0].argumentsText), args);
});

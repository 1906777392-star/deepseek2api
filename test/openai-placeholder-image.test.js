import assert from "node:assert/strict";
import test from "node:test";

import { splitLeakedTranscript } from "../src/services/openai-transcript-sanitizer.js";

test("literal image placeholders never reach visible output", () => {
  assert.deepEqual(splitLeakedTranscript("画好了。\n\n![](IMAGE_URL)\n\n完成。"), {
    visible: "画好了。\n\n\n\n完成。",
    reasoning: ""
  });
});

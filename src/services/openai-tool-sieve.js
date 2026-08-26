import { parseToolCallsFromText } from "./openai-tool-parser.js";

const TOOL_CAPTURE_PAIRS = Object.freeze([
  { open: "<tool_calls", close: "</tool_calls>" },
  { open: "<function_calls", close: "</function_calls>" },
  { open: "<tool_call", close: "</tool_call>" },
  { open: "<function_call", close: "</function_call>" },
  { open: "<invoke", close: "</invoke>" },
  { open: "<tool_use", close: "</tool_use>" }
]);
const ORPHAN_WRAPPER_CLOSE_TAGS = Object.freeze(["</tool_calls", "</function_calls"]);
const TOOL_TAG_PREFIXES = Object.freeze([
  ...TOOL_CAPTURE_PAIRS.map(({ open }) => open),
  ...ORPHAN_WRAPPER_CLOSE_TAGS
]);

function isInsideCodeFence(state, prefix) {
  const combined = `${state.emittedText}${prefix}`;
  return (combined.match(/```/g)?.length ?? 0) % 2 === 1;
}

function findPartialToolTagStart(text) {
  const lastIndex = text.lastIndexOf("<");
  if (lastIndex < 0 || text.slice(lastIndex).includes(">")) {
    return -1;
  }

  const tail = text.slice(lastIndex).toLowerCase();
  return TOOL_TAG_PREFIXES.some((tag) => tag.startsWith(tail)) ? lastIndex : -1;
}

function findToolSegmentStart(state, text) {
  const lower = text.toLowerCase();
  let offset = 0;

  while (offset < lower.length) {
    let bestIndex = -1;
    let matchedOpen = "";

    for (const { open } of TOOL_CAPTURE_PAIRS) {
      const index = lower.indexOf(open, offset);
      if (index >= 0 && (bestIndex === -1 || index < bestIndex)) {
        bestIndex = index;
        matchedOpen = open;
      }
    }

    if (bestIndex === -1) {
      return -1;
    }

    if (!isInsideCodeFence(state, text.slice(0, bestIndex))) {
      return bestIndex;
    }

    offset = bestIndex + matchedOpen.length;
  }

  return -1;
}

function findOrphanWrapperCloseStart(state, text) {
  const lower = text.toLowerCase();
  let offset = 0;

  while (offset < lower.length) {
    let bestIndex = -1;
    let matchedTag = "";

    for (const tag of ORPHAN_WRAPPER_CLOSE_TAGS) {
      const index = lower.indexOf(tag, offset);
      if (index >= 0 && (bestIndex === -1 || index < bestIndex)) {
        bestIndex = index;
        matchedTag = tag;
      }
    }

    if (bestIndex === -1) {
      return -1;
    }

    if (!isInsideCodeFence(state, text.slice(0, bestIndex))) {
      return bestIndex;
    }

    offset = bestIndex + matchedTag.length;
  }

  return -1;
}

function splitSafeContent(state, text) {
  const partialStart = findPartialToolTagStart(text);
  if (partialStart < 0 || isInsideCodeFence(state, text.slice(0, partialStart))) {
    return { safe: text, hold: "" };
  }

  return { safe: text.slice(0, partialStart), hold: text.slice(partialStart) };
}

function consumeCapturedToolBlock(captured, allowedToolNames) {
  const lower = captured.toLowerCase();

  for (const pair of TOOL_CAPTURE_PAIRS) {
    const openIndex = lower.indexOf(pair.open);
    if (openIndex < 0) {
      continue;
    }

    const closeIndex = lower.lastIndexOf(pair.close);
    if (closeIndex < openIndex) {
      return { ready: false };
    }

    const closeEnd = closeIndex + pair.close.length;
    return {
      ready: true,
      prefix: captured.slice(0, openIndex),
      calls: parseToolCallsFromText(captured.slice(openIndex, closeEnd), allowedToolNames),
      suffix: captured.slice(closeEnd)
    };
  }

  return { ready: true, prefix: captured, calls: [], suffix: "" };
}

function pushTextEvent(state, events, text) {
  if (!text) {
    return;
  }

  state.emittedText += text;
  events.push({ type: "text", text });
}

export function createToolSieve(allowedToolNames = []) {
  const state = {
    allowedToolNames,
    capture: "",
    capturing: false,
    emittedText: "",
    pending: ""
  };

  function drain() {
    const events = [];

    while (true) {
      if (state.capturing) {
        if (state.pending) {
          state.capture += state.pending;
          state.pending = "";
        }

        const consumed = consumeCapturedToolBlock(state.capture, state.allowedToolNames);
        if (!consumed.ready) {
          break;
        }

        state.capture = "";
        state.capturing = false;
        pushTextEvent(state, events, consumed.prefix ?? "");
        if (consumed.calls?.length) {
          events.push({ type: "tool_calls", calls: consumed.calls });
        }
        state.pending = `${consumed.suffix ?? ""}${state.pending}`;
        continue;
      }

      if (!state.pending) {
        break;
      }

      const toolStart = findToolSegmentStart(state, state.pending);
      const orphanCloseStart = findOrphanWrapperCloseStart(state, state.pending);
      if (orphanCloseStart >= 0 && (toolStart < 0 || orphanCloseStart < toolStart)) {
        pushTextEvent(state, events, state.pending.slice(0, orphanCloseStart));
        const closeEnd = state.pending.indexOf(">", orphanCloseStart);
        if (closeEnd < 0) {
          state.pending = state.pending.slice(orphanCloseStart);
          break;
        }
        state.pending = state.pending.slice(closeEnd + 1);
        continue;
      }

      if (toolStart >= 0) {
        pushTextEvent(state, events, state.pending.slice(0, toolStart));
        state.capture = state.pending.slice(toolStart);
        state.pending = "";
        state.capturing = true;
        continue;
      }

      const { safe, hold } = splitSafeContent(state, state.pending);
      state.pending = hold;
      pushTextEvent(state, events, safe);
      break;
    }

    return events;
  }

  return Object.freeze({
    flush() {
      const events = drain();

      if (state.capturing) {
        const consumed = consumeCapturedToolBlock(state.capture, state.allowedToolNames);
        if (consumed.ready) {
          pushTextEvent(state, events, consumed.prefix ?? "");
          if (consumed.calls?.length) {
            events.push({ type: "tool_calls", calls: consumed.calls });
          }
          state.pending = `${consumed.suffix ?? ""}${state.pending}`;
          events.push(...drain());
        }
      }

      const pendingClose = findOrphanWrapperCloseStart(state, state.pending);
      if (pendingClose < 0 && findPartialToolTagStart(state.pending) < 0) {
        pushTextEvent(state, events, state.pending);
      } else if (pendingClose > 0) {
        pushTextEvent(state, events, state.pending.slice(0, pendingClose));
      }

      state.capture = "";
      state.capturing = false;
      state.pending = "";
      return events;
    },
    push(chunk) {
      state.pending += typeof chunk === "string" ? chunk : String(chunk ?? "");
      return drain();
    }
  });
}

function toTextEvent(chunk) {
  return { type: "text", text: typeof chunk === "string" ? chunk : String(chunk ?? "") };
}

function flattenToolEvents(events) {
  return events.reduce((output, event) => {
    if (!output.length || event.type !== "text" || output.at(-1).type !== "text") {
      output.push(event);
      return output;
    }

    output[output.length - 1] = {
      type: "text",
      text: `${output.at(-1).text}${event.text}`
    };
    return output;
  }, []);
}

export function splitToolAwareEvents(text, allowedToolNames = []) {
  if (!allowedToolNames?.length) {
    return [toTextEvent(text)];
  }

  const sieve = createToolSieve(allowedToolNames);
  const events = [...sieve.push(text), ...sieve.flush()];
  return flattenToolEvents(events);
}

export function extractToolAwareOutput(text, allowedToolNames = []) {
  const events = splitToolAwareEvents(text, allowedToolNames);
  return {
    events,
    content: events
      .filter((event) => event.type === "text")
      .map((event) => event.text)
      .join(""),
    toolCalls: events.flatMap((event) => event.type === "tool_calls" ? event.calls ?? [] : [])
  };
}

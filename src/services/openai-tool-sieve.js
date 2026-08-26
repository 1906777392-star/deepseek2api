import { parseToolCallsFromText } from "./openai-tool-parser.js";

const TOOL_CAPTURE_PAIRS = Object.freeze([
  { open: "<tool_calls", close: "</tool_calls>" },
  { open: "<function_calls", close: "</function_calls>" },
  { open: "<tool_call", close: "</tool_call>" },
  { open: "<function_call", close: "</function_call>" },
  { open: "<invoke", close: "</invoke>" },
  { open: "<tool_use", close: "</tool_use>" },
  { open: "<|dsml|tool_call", close: "</tool_call>" },
  { open: "<|dsml|function_call", close: "</function_call>" },
  { open: "<|dsml|invoke", close: "</invoke>" },
  { open: "<|dsml|tool_use", close: "</tool_use>" },
  // Fail closed when a reasoning model starts the call in its thinking channel
  // and the visible answer begins halfway through the XML. The shared streaming
  // sieve normally joins both halves; these pairs are the last-resort guard that
  // prevents arguments and credentials from becoming assistant text.
  { open: "<parameters", close: "</tool_call>" },
  { open: "<arguments", close: "</tool_call>" },
  { open: "<input", close: "</tool_call>" },
  { open: "<![cdata[", close: "</tool_call>" }
]);
const IGNORED_WRAPPER_OPEN_TAGS = Object.freeze([
  "<|dsml|tool_calls",
  "<|dsml|function_calls"
]);
const ORPHAN_WRAPPER_CLOSE_TAGS = Object.freeze([
  "</tool_calls",
  "</function_calls",
  "</|dsml|tool_calls",
  "</|dsml|function_calls"
]);
const TOOL_TAG_PREFIXES = Object.freeze([
  ...TOOL_CAPTURE_PAIRS.map(({ open }) => open),
  ...IGNORED_WRAPPER_OPEN_TAGS,
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

function findBoundedTagIndex(lower, tag, offset) {
  let index = lower.indexOf(tag, offset);

  while (index >= 0) {
    const next = lower[index + tag.length] ?? "";
    if (!next || next === ">" || next === "/" || /\s/.test(next)) {
      return index;
    }
    index = lower.indexOf(tag, index + tag.length);
  }

  return -1;
}

function findToolSegmentStart(state, text) {
  const lower = text.toLowerCase();
  let offset = 0;

  while (offset < lower.length) {
    let bestIndex = -1;
    let matchedOpen = "";

    for (const { open } of TOOL_CAPTURE_PAIRS) {
      const index = findBoundedTagIndex(lower, open, offset);
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

function findProtocolWrapperStart(state, text, tags) {
  const lower = text.toLowerCase();
  let offset = 0;

  while (offset < lower.length) {
    let bestIndex = -1;
    let matchedTag = "";

    for (const tag of tags) {
      const index = findBoundedTagIndex(lower, tag, offset);
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

function findIgnoredWrapperOpenStart(state, text) {
  return findProtocolWrapperStart(state, text, IGNORED_WRAPPER_OPEN_TAGS);
}

function findOrphanWrapperCloseStart(state, text) {
  return findProtocolWrapperStart(state, text, ORPHAN_WRAPPER_CLOSE_TAGS);
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
    const openIndex = findBoundedTagIndex(lower, pair.open, 0);
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

function consumeWrapperTag(state, events, start) {
  pushTextEvent(state, events, state.pending.slice(0, start));
  const end = state.pending.indexOf(">", start);
  if (end < 0) {
    state.pending = state.pending.slice(start);
    return false;
  }
  state.pending = state.pending.slice(end + 1).replace(/^\s+/, "");
  return true;
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
      const ignoredOpenStart = findIgnoredWrapperOpenStart(state, state.pending);
      const orphanCloseStart = findOrphanWrapperCloseStart(state, state.pending);
      const wrapperStarts = [ignoredOpenStart, orphanCloseStart].filter((index) => index >= 0);
      const wrapperStart = wrapperStarts.length ? Math.min(...wrapperStarts) : -1;

      if (wrapperStart >= 0 && (toolStart < 0 || wrapperStart <= toolStart)) {
        if (!consumeWrapperTag(state, events, wrapperStart)) {
          break;
        }
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

      const ignoredOpen = findIgnoredWrapperOpenStart(state, state.pending);
      const pendingClose = findOrphanWrapperCloseStart(state, state.pending);
      const wrapperStarts = [ignoredOpen, pendingClose].filter((index) => index >= 0);
      const wrapperStart = wrapperStarts.length ? Math.min(...wrapperStarts) : -1;
      if (wrapperStart < 0 && findPartialToolTagStart(state.pending) < 0) {
        pushTextEvent(state, events, state.pending);
      } else if (wrapperStart > 0) {
        pushTextEvent(state, events, state.pending.slice(0, wrapperStart));
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

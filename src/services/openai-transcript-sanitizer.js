function normalizeLine(value) {
  return String(value ?? "").replace(/\r$/, "");
}

function isToolTranscriptStart(line) {
  return /^\s*TOOL:\s*(?:Tool result for\b|Image reader result\b)/i.test(normalizeLine(line));
}

function assistantTranscriptText(line) {
  const match = normalizeLine(line).match(/^\s*ASSISTANT:\s?(.*)$/i);
  return match ? match[1] : null;
}

function removePlaceholderImages(value) {
  return String(value ?? "")
    .replace(/!\[[^\]]*]\(\s*(?:IMAGE_URL|IMAGE_LINK|图片链接|图片URL)\s*\)/gi, "")
    .replace(/<img\b[^>]*\bsrc=["']?(?:IMAGE_URL|IMAGE_LINK|图片链接|图片URL)["']?[^>]*>/gi, "");
}

export function splitLeakedTranscript(value) {
  const lines = String(value ?? "").split(/(?<=\n)/);
  let mode = "visible";
  let visible = "";
  let reasoning = "";

  for (const rawLine of lines) {
    const line = rawLine.replace(/\n$/, "");
    const newline = rawLine.endsWith("\n") ? "\n" : "";
    if (mode === "visible") {
      if (isToolTranscriptStart(line)) {
        mode = "tool";
        continue;
      }
      visible += removePlaceholderImages(rawLine);
      continue;
    }
    if (mode === "tool") {
      const assistantText = assistantTranscriptText(line);
      if (assistantText !== null) {
        mode = "assistant";
        if (assistantText) reasoning += `${assistantText}${newline}`;
      }
      continue;
    }
    if (!line.trim()) {
      mode = "visible";
      if (reasoning && !reasoning.endsWith("\n")) reasoning += "\n";
      continue;
    }
    reasoning += rawLine;
  }

  return { visible, reasoning };
}

export function createTranscriptLeakRouter() {
  let pending = "";
  let mode = "visible";

  function routeLine(rawLine) {
    const line = rawLine.replace(/\n$/, "");
    const newline = rawLine.endsWith("\n") ? "\n" : "";
    if (mode === "visible") {
      if (isToolTranscriptStart(line)) {
        mode = "tool";
        return [];
      }
      const safe = removePlaceholderImages(rawLine);
      return safe ? [{ kind: "response", text: safe }] : [];
    }
    if (mode === "tool") {
      const assistantText = assistantTranscriptText(line);
      if (assistantText !== null) {
        mode = "assistant";
        return assistantText ? [{ kind: "thinking", text: `${assistantText}${newline}` }] : [];
      }
      return [];
    }
    if (!line.trim()) {
      mode = "visible";
      return [];
    }
    return [{ kind: "thinking", text: rawLine }];
  }

  function drain(final = false) {
    const events = [];
    while (true) {
      const newlineIndex = pending.indexOf("\n");
      if (newlineIndex < 0) break;
      const rawLine = pending.slice(0, newlineIndex + 1);
      pending = pending.slice(newlineIndex + 1);
      events.push(...routeLine(rawLine));
    }
    if (final && pending) {
      events.push(...routeLine(pending));
      pending = "";
    }
    return events;
  }

  return Object.freeze({
    push(text) {
      pending += String(text ?? "");
      return drain(false);
    },
    flush() {
      return drain(true);
    }
  });
}

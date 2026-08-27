function normalizeLine(value) {
  return String(value ?? "").replace(/\r$/, "");
}

const AI_DISCLAIMER_PATTERNS = [
  /\s*本回答由\s*AI\s*生成\s*[，,、；;。]?\s*内容仅供参考\s*[，,、；;。]?\s*请仔细甄别\s*[。.!！]?\s*$/iu,
  /\s*内容由\s*AI\s*生成\s*[，,、；;。]?\s*请仔细甄别\s*[。.!！]?\s*$/iu
];
const AI_DISCLAIMER_STARTS = ["本回答由", "内容由"];

export function stripAiGeneratedDisclaimer(value) {
  let output = String(value ?? "");
  for (const pattern of AI_DISCLAIMER_PATTERNS) output = output.replace(pattern, "");
  return output.replace(/[ \t]+$/g, "");
}

export function createAiDisclaimerFilter(onSafeText) {
  let pending = "";

  function findPossibleStart() {
    let earliest = -1;
    for (const marker of AI_DISCLAIMER_STARTS) {
      const index = pending.indexOf(marker);
      if (index >= 0 && (earliest < 0 || index < earliest)) earliest = index;
    }
    return earliest;
  }

  return Object.freeze({
    push(text) {
      pending += String(text ?? "");
      const start = findPossibleStart();
      if (start >= 0) {
        const safe = pending.slice(0, start);
        pending = pending.slice(start);
        if (safe) onSafeText(safe);
        return;
      }
      const keep = Math.max(...AI_DISCLAIMER_STARTS.map((item) => item.length - 1));
      if (pending.length <= keep) return;
      const safe = pending.slice(0, -keep);
      pending = pending.slice(-keep);
      if (safe) onSafeText(safe);
    },
    flush() {
      const safe = stripAiGeneratedDisclaimer(pending);
      pending = "";
      if (safe) onSafeText(safe);
    }
  });
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

  return { visible: stripAiGeneratedDisclaimer(visible), reasoning };
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

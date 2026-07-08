import { escapeHtml } from "/utils.js";

const SECTION_KIND_BY_TYPE = Object.freeze({
  THINK: "thinking",
  RESPONSE: "response"
});

function resolveSectionKind(type) {
  return type ? (SECTION_KIND_BY_TYPE[type] ?? "response") : null;
}

function getInitialFragment(payload) {
  const fragments = payload.v?.response?.fragments;
  return Array.isArray(fragments) ? fragments.at(-1) ?? null : null;
}

function getAppendedFragment(payload) {
  if (payload.p !== "response/fragments" || payload.o !== "APPEND") {
    return null;
  }

  return Array.isArray(payload.v) ? payload.v.at(-1) ?? null : null;
}

function extractFragmentText(payload) {
  const fragment = getInitialFragment(payload);
  if (typeof fragment?.content === "string") {
    return fragment.content;
  }

  const appendedFragment = getAppendedFragment(payload);
  if (typeof appendedFragment?.content === "string") {
    return appendedFragment.content;
  }

  if (payload.p === "response/fragments/-1/content" && typeof payload.v === "string") {
    return payload.v;
  }

  if (!("p" in payload) && typeof payload.v === "string") {
    return payload.v;
  }

  return "";
}

function toSection(kind, content) {
  return { kind, content };
}

function renderSectionMarkup(section) {
  const label = section.kind === "thinking"
    ? '<div class="message-label">THINKING</div>'
    : "";

  return `
    <div class="message-section ${section.kind}" data-message-section="true" data-section-kind="${escapeHtml(section.kind)}">
      ${label}<span data-section-text>${escapeHtml(section.content)}</span>
    </div>
  `;
}

export function mapServerFile(file) {
  return {
    id: file.id,
    status: file.status,
    fileName: file.file_name,
    previewable: Boolean(file.previewable),
    fileSize: file.file_size,
    tokenUsage: file.token_usage,
    errorCode: file.error_code,
    insertedAt: file.inserted_at,
    updatedAt: file.updated_at
  };
}

function normalizeSections(sections, content) {
  if (Array.isArray(sections) && sections.length) {
    return sections;
  }

  if (!content) {
    return [];
  }

  return [toSection("response", content)];
}

export function createSseParser(onEvent) {
  let buffer = "";
  let eventName = "message";
  let dataLines = [];

  function emit() {
    if (!dataLines.length) {
      eventName = "message";
      return;
    }

    onEvent({ event: eventName, data: dataLines.join("\n") });
    eventName = "message";
    dataLines = [];
  }

  return {
    push(chunk) {
      buffer += chunk;

      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);

        if (!line) {
          emit();
          continue;
        }

        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          continue;
        }

        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    },
    flush() {
      if (buffer.trim()) {
        dataLines.push(buffer.trim());
        buffer = "";
      }

      emit();
    }
  };
}

export function createDeepseekDeltaDecoder() {
  let currentKind = "response";

  return {
    consume(payloadText) {
      const payload = JSON.parse(payloadText);
      const fragment = getAppendedFragment(payload) ?? getInitialFragment(payload);
      if (fragment?.type) {
        currentKind = resolveSectionKind(fragment.type) ?? currentKind;
      }
      const text = extractFragmentText(payload);
      return text ? { kind: currentKind, text } : null;
    }
  };
}

export function mapHistoryMessage(message) {
  const sections = (message.fragments || [])
    .filter((fragment) => fragment.content)
    .map((fragment) => toSection(resolveSectionKind(fragment.type) ?? "response", fragment.content));

  return {
    id: message.message_id,
    parentId: message.parent_id,
    role: message.role,
    files: (message.files || []).map(mapServerFile),
    sections
  };
}

export function appendDelta(message, delta) {
  const sections = normalizeSections(message.sections, message.content);
  if (!delta?.text) {
    return { ...message, sections };
  }

  const lastSection = sections.at(-1);
  if (lastSection?.kind === delta.kind) {
    const nextSection = toSection(lastSection.kind, lastSection.content + delta.text);
    return {
      ...message,
      sections: [...sections.slice(0, -1), nextSection]
    };
  }

  return {
    ...message,
    sections: [...sections, toSection(delta.kind, delta.text)]
  };
}

export function renderMessageContent(message) {
  const sections = normalizeSections(message.sections, message.content);
  return sections.map(renderSectionMarkup).join("");
}

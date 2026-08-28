import { createOpenAiError } from "./openai-error.js";

const TOOL_CHOICE_AUTO = "auto";
const TOOL_CHOICE_NONE = "none";
const TOOL_CHOICE_REQUIRED = "required";
const TOOL_CHOICE_FORCED = "forced";

function toStringSafe(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

export function getToolFunction(tool) {
  if (!tool || typeof tool !== "object") return null;
  return tool.function && typeof tool.function === "object" ? tool.function : tool;
}

export function getToolName(tool) {
  return toStringSafe(getToolFunction(tool)?.name).trim();
}

function extractDeclaredToolNames(tools) {
  return Array.isArray(tools) ? tools.map(getToolName).filter(Boolean) : [];
}

function hasMessageTooling(messages) {
  return Array.isArray(messages) && messages.some((message) => {
    const role = toStringSafe(message?.role).trim().toLowerCase();
    return role === "tool" || role === "function" || Array.isArray(message?.tool_calls);
  });
}

export function hasChatToolingRequest(body) {
  return Boolean(Array.isArray(body?.tools) && body.tools.length > 0 || body?.tool_choice !== undefined || hasMessageTooling(body?.messages));
}

function parseForcedToolName(toolChoice) {
  if (!toolChoice || typeof toolChoice !== "object") return "";
  if (toStringSafe(toolChoice.type).trim() !== "function") throw createOpenAiError(400, `Unsupported tool_choice.type: ${toolChoice.type || ""}`);
  const name = toStringSafe(toolChoice.function?.name ?? toolChoice.name).trim();
  if (!name) throw createOpenAiError(400, "tool_choice function requires name");
  return name;
}

export function resolveToolChoicePolicy({ tools, toolChoice }) {
  const declaredToolNames = extractDeclaredToolNames(tools);
  if (!declaredToolNames.length) {
    if (toolChoice === undefined || toolChoice === null) return { allowedToolNames: [], declaredToolNames, forcedName: "", mode: TOOL_CHOICE_NONE };
    throw createOpenAiError(400, "tool_choice requires non-empty tools");
  }
  if (toolChoice === undefined || toolChoice === null || toolChoice === TOOL_CHOICE_AUTO) return { allowedToolNames: declaredToolNames, declaredToolNames, forcedName: "", mode: TOOL_CHOICE_AUTO };
  if (toolChoice === TOOL_CHOICE_NONE) return { allowedToolNames: [], declaredToolNames, forcedName: "", mode: TOOL_CHOICE_NONE };
  if (toolChoice === TOOL_CHOICE_REQUIRED) return { allowedToolNames: declaredToolNames, declaredToolNames, forcedName: "", mode: TOOL_CHOICE_REQUIRED };
  const forcedName = parseForcedToolName(toolChoice);
  if (!declaredToolNames.includes(forcedName)) throw createOpenAiError(400, `tool_choice forced function "${forcedName}" is not declared in tools`);
  return { allowedToolNames: [forcedName], declaredToolNames, forcedName, mode: TOOL_CHOICE_FORCED };
}

export function ensureToolChoiceSatisfied(policy, calls) {
  if (policy.mode === TOOL_CHOICE_REQUIRED && !calls.length) throw createOpenAiError(422, "tool_choice requires at least one valid tool call.", "tool_choice_violation");
  if (policy.mode === TOOL_CHOICE_FORCED && !calls.some((call) => call.name === policy.forcedName)) throw createOpenAiError(422, `tool_choice requires tool "${policy.forcedName}".`, "tool_choice_violation");
}

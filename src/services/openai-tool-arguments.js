import { recoverLoginArguments } from "./openai-login-arguments.js";
import { getToolFunction, getToolName } from "./openai-tool-policy.js";

const IMAGE_TOOLS = new Set(["draw", "redraw", "photo_tool", "inpaint", "character_reference", "comic_page", "vibe_transfer", "character_panel"]);
const SENSITIVE_TOKEN_KEYS = new Set(["token", "token_2", "login_code", "登录码"]);

function textOf(message) {
  if (typeof message?.content === "string") return message.content.trim();
  if (!Array.isArray(message?.content)) return "";
  return message.content.map((part) => part?.text ?? part?.output_text ?? part?.content ?? "").filter(Boolean).join("\n").trim();
}

function latestUserText(messages = []) {
  const message = [...messages].reverse().find((item) => String(item?.role ?? "").toLowerCase() === "user");
  return textOf(message);
}

function parseObject(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function isMissing(value) {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

function findNestedToken(value) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    for (const item of value) { const found = findNestedToken(item); if (found) return found; }
    return "";
  }
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_TOKEN_KEYS.has(String(key).toLowerCase()) && typeof item === "string" && item.trim()) return item.trim();
    const found = findNestedToken(item);
    if (found) return found;
  }
  return "";
}

function tokenFromText(text) {
  const source = String(text ?? "").trim();
  if (!source) return "";
  try { const found = findNestedToken(JSON.parse(source)); if (found) return found; } catch {}
  const match = source.match(/(?:"?(?:token_2|login_code|登录码)"?\s*[:=：]\s*["“]?)([^\s"”'，。；;]+)/i);
  return match?.[1]?.trim() ?? "";
}

function latestLoginToken(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const role = String(message?.role ?? "").toLowerCase();
    if (role !== "tool" && role !== "function") continue;
    const token = tokenFromText(textOf(message));
    if (token) return token;
  }
  return "";
}

function vagueCreativeRequest(text) {
  return /^(?:随便(?:你)?|你决定|直接做|都行|看着办|随机|whatever)[啊呀吧。！!\s]*$/i.test(String(text ?? "").trim());
}

function genericVisualDescription() {
  return "1girl, full body, calm expression, standing in a quiet starlit field, flowing silver-white hair, dark elegant outfit, soft blue and silver moonlight, balanced composition, detailed atmospheric background";
}

function propertyDefault(name, schema, context) {
  if (Object.hasOwn(schema ?? {}, "default")) return schema.default;
  if (Object.hasOwn(schema ?? {}, "const")) return schema.const;

  if (name === "coherence_checked") return true;
  if (name === "count") return 1;
  if (name === "skeleton_strength") return 0.95;
  if (name === "vibe_strength") return 0.6;
  if (name === "information_extracted") return 1;
  if (name === "token_2" || name === "token") return context.loginToken || "";
  if (name === "invite_code" || name === "avoid" || name === "scene" || name === "character" || name === "second_character_image") return "";
  if (name === "characters" || name === "blocking" || name === "reminders" || name === "reviewers") return [];
  if (name === "aspect_2" || name === "aspect") {
    const values = schema?.enum ?? [];
    return values.includes("竖图") ? "竖图" : values[0];
  }
  if (name === "change_scale") return schema?.enum?.includes("中等") ? "中等" : schema?.enum?.[0];
  if (name === "fidelity") return schema?.enum?.includes("identity_only") ? "identity_only" : schema?.enum?.[0];
  if (name === "layout") return schema?.enum?.includes("4_grid") ? "4_grid" : schema?.enum?.[0];
  if (name === "english_visual_description" && IMAGE_TOOLS.has(context.toolName) && vagueCreativeRequest(context.userText)) return genericVisualDescription();

  return undefined;
}

function fillSchemaDefaults(args, schema, context) {
  const output = { ...args };
  const properties = schema?.properties ?? {};
  for (const [name, propertySchema] of Object.entries(properties)) {
    if (!isMissing(output[name])) continue;
    const value = propertyDefault(name, propertySchema, context);
    if (value !== undefined) output[name] = value;
  }

  const required = Array.isArray(schema?.required) ? schema.required : [];
  const missing = required.filter((name) => isMissing(output[name]));
  if (missing.length === 1) {
    const name = missing[0];
    const propertySchema = properties[name] ?? {};
    if (propertySchema.type === "string" && context.userText && !SENSITIVE_TOKEN_KEYS.has(name)) output[name] = context.userText;
  }
  return output;
}

function validateRequired(args, schema) {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  return required.filter((name) => isMissing(args[name]));
}

export function repairToolCalls({ calls = [], tools = [], messages = [] }) {
  const toolByName = new Map(tools.map((tool) => [getToolName(tool), getToolFunction(tool)]).filter(([name]) => name));
  const userText = latestUserText(messages);
  const loginToken = latestLoginToken(messages);
  const loginRepaired = recoverLoginArguments(calls, messages);
  const repaired = [];
  const rejected = [];

  for (const call of loginRepaired) {
    const name = String(call?.name ?? "").trim();
    const definition = toolByName.get(name);
    const schema = definition?.parameters ?? {};
    const original = parseObject(call?.argumentsText ?? call?.input);
    const args = fillSchemaDefaults(original, schema, { toolName: name, userText, loginToken });
    const missing = validateRequired(args, schema);
    if (missing.length) { rejected.push({ name, missing }); continue; }
    repaired.push({ ...call, argumentsText: JSON.stringify(args), input: args });
  }

  return { calls: repaired, rejected };
}

export function formatRejectedToolCalls(rejected = []) {
  if (!rejected.length) return "";
  const details = rejected.map((item) => `${item.name}: ${item.missing.join(", ")}`).join("；");
  return `工具调用缺少必要参数（${details}），请补充这些信息后再执行。`;
}

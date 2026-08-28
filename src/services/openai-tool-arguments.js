import { recoverContextualToolArguments } from "./openai-tool-context.js";
import { getToolFunction, getToolName } from "./openai-tool-policy.js";

function parseArguments(call) {
  const raw = typeof call?.argumentsText === "string" ? call.argumentsText : JSON.stringify(call?.input ?? {});
  try {
    const value = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "parameters must be a JSON object", value: null };
    return { error: "", value };
  } catch { return { error: "parameters are not valid JSON", value: null }; }
}

function matchesType(value, type) {
  if (!type) return true;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "string") return typeof value === "string";
  return true;
}

function validateValue(value, schema, path, issues) {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) issues.push(`${path} must be one of: ${schema.enum.join(", ")}`);
  if (!matchesType(value, schema.type)) { issues.push(`${path} must be ${schema.type}`); return; }
  if (schema.type === "object") validateObject(value, schema, path, issues);
  if (schema.type === "array" && schema.items) value.forEach((item, index) => validateValue(item, schema.items, `${path}[${index}]`, issues));
}

function validateObject(value, schema, path, issues) {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  for (const name of required) if (!Object.hasOwn(value ?? {}, name)) issues.push(`${path ? `${path}.` : ""}${name} is required`);
  for (const [name, propertySchema] of Object.entries(schema?.properties ?? {})) {
    if (!Object.hasOwn(value ?? {}, name) || value[name] === null) continue;
    validateValue(value[name], propertySchema, path ? `${path}.${name}` : name, issues);
  }
}

export function validateToolCalls({ calls = [], tools = [] }) {
  const recoveredCalls = recoverContextualToolArguments(calls, tools);
  const toolByName = new Map(tools.map((tool) => [getToolName(tool), getToolFunction(tool)]).filter(([name]) => name));
  const valid = [];
  const rejected = [];

  for (const call of recoveredCalls) {
    const name = String(call?.name ?? "").trim();
    const parsed = parseArguments(call);
    if (parsed.error) { rejected.push({ name, issues: [parsed.error] }); continue; }
    const issues = [];
    const schema = toolByName.get(name)?.parameters;
    if (schema) validateObject(parsed.value, schema, "", issues);
    if (issues.length) { rejected.push({ name, issues }); continue; }
    valid.push({ ...call, argumentsText: JSON.stringify(parsed.value), input: parsed.value });
  }
  return { calls: rejected.length ? [] : valid, rejected };
}

export function formatRejectedToolCalls(rejected = []) {
  if (!rejected.length) return "";
  const details = rejected.map((item) => `${item.name || "unknown"}: ${item.issues.join(", ")}`).join("；");
  return `AI 连续两次都没有生成完整工具参数（${details}）。请补充确实无法从上下文判断的信息后再试。`;
}

export function summarizeRejectedToolCalls(rejected = []) {
  return rejected.map((item) => `${item.name || "unknown"}: ${item.issues.join("; ")}`).join(" | ");
}

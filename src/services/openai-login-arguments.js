function textOf(message) {
  if (typeof message?.content === "string") return message.content.trim();
  if (!Array.isArray(message?.content)) return "";
  return message.content.map((part) => part?.text ?? part?.output_text ?? part?.content ?? "").filter(Boolean).join("\n").trim();
}

function callName(call) { return String(call?.name ?? "").trim(); }
function callArguments(call) { return String(call?.argumentsText ?? "").trim(); }

function parseArgs(call) {
  try {
    const value = JSON.parse(callArguments(call) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function isEmpty(value) { return value === undefined || value === null || String(value).trim() === ""; }

function looksLikePasswordStatement(text) {
  return /(?:这是|这个就是|这就是|密码是|密码为|password\s*(?:is|:))/i.test(text);
}

function candidateFromLatestUser(messages = []) {
  const latest = [...messages].reverse().find((message) => String(message?.role ?? "").toLowerCase() === "user");
  const value = textOf(latest);
  if (!value || looksLikePasswordStatement(value)) return "";
  return value;
}

/**
 * DeepSeek may state a user-provided password in reasoning but emit login({}).
 * Recover only an explicitly user-provided value on a login call; never log it.
 */
export function recoverLoginArguments(calls, messages = []) {
  const candidate = candidateFromLatestUser(messages);
  if (!candidate) return calls;

  return (calls ?? []).map((call) => {
    if (callName(call) !== "login") return call;
    const args = parseArgs(call);
    if (!isEmpty(args.password)) return call;
    const repaired = { ...args, password: candidate };
    return { ...call, argumentsText: JSON.stringify(repaired), input: repaired };
  });
}

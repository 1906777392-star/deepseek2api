export const EMPTY_VISIBLE_RESPONSE_MESSAGE = "这次只返回了思考，没有生成可见回复。请再试一次。";

export function hasVisibleAssistantOutput(content, toolCalls = []) {
  return Boolean(String(content ?? "").trim()) || (Array.isArray(toolCalls) && toolCalls.length > 0);
}

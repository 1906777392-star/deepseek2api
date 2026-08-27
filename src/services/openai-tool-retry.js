export function isRequiredToolPolicy(policy) {
  return policy?.mode === "required" || policy?.mode === "forced";
}

export function buildToolCorrectionPrompt(policy) {
  const target = policy?.mode === "forced" && policy?.forcedName
    ? `Call only the declared tool ${policy.forcedName}.`
    : "Call at least one declared tool.";
  return [
    "SYSTEM: Your previous response failed because it did not contain a valid declared tool call.",
    target,
    "Do not browse internally, answer the user, explain, plan, or include reasoning.",
    "Return only one raw XML tool-call block using this exact structure:",
    "<tool_calls>",
    "  <tool_call>",
    "    <tool_name>DECLARED_TOOL_NAME</tool_name>",
    "    <parameters>{\"key\":\"value\"}</parameters>",
    "  </tool_call>",
    "</tool_calls>",
    "ASSISTANT:"
  ].join("\n");
}

export function createToolCorrectionRequest(requestOptions, firstResult) {
  return {
    ...requestOptions,
    prompt: buildToolCorrectionPrompt(requestOptions.toolChoicePolicy),
    imageInputs: [],
    refFileIds: [],
    sessionId: firstResult?.sessionId ?? requestOptions.sessionId,
    parentMessageId: firstResult?.responseMessageId ?? requestOptions.parentMessageId ?? null,
    model: { ...requestOptions.model, searchEnabled: false }
  };
}

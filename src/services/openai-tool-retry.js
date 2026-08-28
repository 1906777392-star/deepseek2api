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
    "Do not browse internally, answer the user, explain, plan, promise, simulate, or describe the call.",
    "Return only one raw XML tool-call block."
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

export function buildToolArgumentCorrectionPrompt(rejectedSummary) {
  return [
    "SYSTEM: Your previous tool call had invalid or missing parameters.",
    `Validation errors: ${rejectedSummary}`,
    "Rewrite the tool call yourself using the original user request, conversation context, and declared schema.",
    "Choose all inferable creative/default values yourself. Do not leave required fields empty and do not output {}.",
    "If the user already supplied a password, token, code, description, or choice, place that exact value only in the matching tool parameter without exposing it in text.",
    "Return only one raw XML <tool_calls> block. No explanation, reasoning, markdown, or role labels."
  ].join("\n");
}

export function createToolArgumentCorrectionRequest(requestOptions, firstResult, rejectedSummary) {
  return {
    ...requestOptions,
    prompt: buildToolArgumentCorrectionPrompt(rejectedSummary),
    imageInputs: [],
    refFileIds: [],
    sessionId: firstResult?.sessionId ?? requestOptions.sessionId,
    parentMessageId: firstResult?.responseMessageId ?? requestOptions.parentMessageId ?? null,
    model: { ...requestOptions.model, searchEnabled: false }
  };
}

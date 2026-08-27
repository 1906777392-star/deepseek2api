export function isRequiredToolPolicy() {
  // Required/forced policies may still be validated when explicitly supplied,
  // but the bridge no longer performs a hidden second completion to coerce a
  // missing call. Kelivo should receive the model's real first response.
  return false;
}

export function buildToolCorrectionPrompt(policy) {
  const target = policy?.mode === "forced" && policy?.forcedName
    ? `Call only the declared tool ${policy.forcedName}.`
    : "Call at least one declared tool.";
  return [
    "SYSTEM: Your previous response failed because it did not contain a valid declared tool call.",
    target,
    "Do not browse internally, answer the user, explain, plan, or include reasoning.",
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

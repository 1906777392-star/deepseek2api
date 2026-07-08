const CHAT_MODELS = Object.freeze([
  Object.freeze({ id: "deepseek-chat", modelType: "default", searchEnabled: false, thinkingEnabled: false, supportsUploads: true }),
  Object.freeze({ id: "deepseek-chat-search", modelType: "default", searchEnabled: true, thinkingEnabled: false, supportsUploads: true }),
  Object.freeze({ id: "deepseek-reasoner", modelType: "default", searchEnabled: false, thinkingEnabled: true, supportsUploads: true }),
  Object.freeze({ id: "deepseek-reasoner-search", modelType: "default", searchEnabled: true, thinkingEnabled: true, supportsUploads: true }),
  Object.freeze({ id: "deepseek-chat-expert", modelType: "expert", searchEnabled: false, thinkingEnabled: false, supportsUploads: false }),
  Object.freeze({ id: "deepseek-reasoner-expert", modelType: "expert", searchEnabled: false, thinkingEnabled: true, supportsUploads: false }),
  Object.freeze({ id: "deepseek-vision", modelType: "vision", searchEnabled: false, thinkingEnabled: false, supportsUploads: true }),
  Object.freeze({ id: "deepseek-vision-reasoner", modelType: "vision", searchEnabled: false, thinkingEnabled: true, supportsUploads: true })
]);

const CHAT_MODEL_MAP = Object.freeze(
  Object.fromEntries(CHAT_MODELS.map((model) => [model.id, model]))
);

export function resolveChatModel(modelId) {
  const resolvedModel = CHAT_MODEL_MAP[modelId];

  if (!resolvedModel) {
    throw new Error(`Unsupported chat model: ${modelId}`);
  }

  return resolvedModel;
}

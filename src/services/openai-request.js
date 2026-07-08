const DEFAULT_OPENAI_MODEL = "deepseek-chat";
const MODEL_CREATED_AT = 0;

const OPENAI_MODELS = Object.freeze([
  Object.freeze({ id: "deepseek-chat", modelType: "default", thinkingEnabled: false, searchEnabled: false, vision: false, supportsUploads: true }),
  Object.freeze({ id: "deepseek-chat-search", modelType: "default", thinkingEnabled: false, searchEnabled: true, vision: false, supportsUploads: true }),
  Object.freeze({ id: "deepseek-reasoner", modelType: "default", thinkingEnabled: true, searchEnabled: false, vision: false, supportsUploads: true }),
  Object.freeze({ id: "deepseek-reasoner-search", modelType: "default", thinkingEnabled: true, searchEnabled: true, vision: false, supportsUploads: true }),
  Object.freeze({ id: "deepseek-chat-expert", modelType: "expert", thinkingEnabled: false, searchEnabled: false, vision: false, supportsUploads: false }),
  Object.freeze({ id: "deepseek-reasoner-expert", modelType: "expert", thinkingEnabled: true, searchEnabled: false, vision: false, supportsUploads: false }),
  Object.freeze({ id: "deepseek-vision", modelType: "vision", thinkingEnabled: false, searchEnabled: false, vision: true, supportsUploads: true }),
  Object.freeze({ id: "deepseek-vision-reasoner", modelType: "vision", thinkingEnabled: true, searchEnabled: false, vision: true, supportsUploads: true })
]);

const OPENAI_MODEL_MAP = Object.freeze(
  Object.fromEntries(OPENAI_MODELS.map((model) => [model.id, model]))
);

function createBadRequestError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

export function listOpenAiModels() {
  return OPENAI_MODELS.map(({ id }) => ({
    id,
    object: "model",
    created: MODEL_CREATED_AT,
    owned_by: "deepseek-web"
  }));
}

export function resolveOpenAiModel(model) {
  const modelId = model ?? DEFAULT_OPENAI_MODEL;
  const resolvedModel = OPENAI_MODEL_MAP[modelId];

  if (!resolvedModel) {
    throw createBadRequestError(`Unsupported model: ${modelId}`);
  }

  return resolvedModel;
}

export function assertNoLegacySearchOptions(body) {
  if (Object.hasOwn(body ?? {}, "web_search_options")) {
    throw createBadRequestError(
      "Search is controlled by model suffix '-search', not web_search_options"
    );
  }
}

export { DEFAULT_OPENAI_MODEL };

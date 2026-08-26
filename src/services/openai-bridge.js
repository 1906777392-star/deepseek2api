import { randomUUID } from "node:crypto";

import { collectCompletionContent, streamCompletionContent } from "./openai-completion-runner.js";
import { assertNoLegacySearchOptions, resolveOpenAiModel } from "./openai-request.js";
import { createToolSieve, extractToolAwareOutput } from "./openai-tool-sieve.js";
import { buildOpenAiPrompt } from "./openai-tool-prompt.js";
import { ensureToolChoiceSatisfied, hasChatToolingRequest } from "./openai-tool-policy.js";
import { createOpenAiError } from "./openai-error.js";

function createCompletionId() {
  return `chatcmpl_${randomUUID()}`;
}

function createChatToolCalls(calls, startIndex = 0) {
  return calls.map((call, offset) => ({
    index: startIndex + offset,
    id: call.id,
    type: "function",
    function: {
      name: call.name,
      arguments: call.argumentsText
    }
  }));
}

function extractImageInputs(messages) {
  return (messages ?? []).flatMap((message) => {
    if (!Array.isArray(message?.content)) {
      return [];
    }

    return message.content.flatMap((part) => {
      if (part?.type !== "image_url") {
        return [];
      }

      const imageUrl = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      return imageUrl ? [{ url: imageUrl, detail: part.image_url?.detail ?? "auto" }] : [];
    });
  });
}

function resolveCompletionRequest(body, toolCallsEnabled) {
  assertNoLegacySearchOptions(body);

  if (!toolCallsEnabled && hasChatToolingRequest(body)) {
    throw createOpenAiError(400, "Tool calls are disabled for this API key");
  }

  const model = resolveOpenAiModel(body?.model);
  const imageInputs = extractImageInputs(body?.messages ?? []);
  const refFileIds = Array.isArray(body?.ref_file_ids) ? body.ref_file_ids.filter(Boolean) : [];

  if ((imageInputs.length || refFileIds.length) && model.supportsUploads === false) {
    throw createOpenAiError(400, "Expert models do not support file or image uploads");
  }

  if (imageInputs.length && model.modelType !== "vision") {
    throw createOpenAiError(400, "Image inputs require deepseek-vision or deepseek-vision-reasoner");
  }

  const promptRequest = buildOpenAiPrompt({
    messages: body?.messages ?? [],
    toolChoice: toolCallsEnabled ? body?.tool_choice : undefined,
    tools: toolCallsEnabled ? body?.tools ?? [] : []
  });

  return {
    model,
    prompt: promptRequest.prompt,
    imageInputs,
    toolChoicePolicy: promptRequest.toolChoicePolicy,
    toolNames: promptRequest.toolNames
  };
}

function withReasoning(message, reasoningContent) {
  return reasoningContent
    ? { ...message, reasoning_content: reasoningContent }
    : message;
}

function buildChatCompletionPayload(completionId, requestOptions, content, reasoningContent) {
  const parsed = requestOptions.toolNames.length
    ? extractToolAwareOutput(content, requestOptions.toolNames)
    : { content, toolCalls: [] };

  ensureToolChoiceSatisfied(requestOptions.toolChoicePolicy, parsed.toolCalls);

  if (parsed.toolCalls.length) {
    return {
      id: completionId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: requestOptions.model.id,
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: withReasoning({
            role: "assistant",
            content: parsed.content.length ? parsed.content : null,
            tool_calls: createChatToolCalls(parsed.toolCalls)
          }, reasoningContent)
        }
      ]
    };
  }

  return {
    id: completionId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestOptions.model.id,
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: withReasoning({
          role: "assistant",
          content: parsed.content
        }, reasoningContent)
      }
    ]
  };
}

function buildChunkPayload(completionId, model, delta, finishReason) {
  const choice = finishReason
    ? { index: 0, delta: {}, finish_reason: finishReason }
    : { index: 0, delta };

  return {
    id: completionId,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [choice]
  };
}

function writeSseChunk(response, payload) {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function collectOpenAiResponse({
  account,
  body,
  deleteAfterFinish = false,
  toolCallsEnabled = false
}) {
  const requestOptions = resolveCompletionRequest(body, toolCallsEnabled);
  const { content, reasoningContent } = await collectCompletionContent({
    account,
    deleteAfterFinish,
    requestOptions
  });

  return buildChatCompletionPayload(
    createCompletionId(),
    requestOptions,
    content,
    reasoningContent
  );
}

export async function streamOpenAiResponse(options) {
  const {
    account,
    body,
    deleteAfterFinish = false,
    response,
    toolCallsEnabled = false
  } = options;
  const completionId = createCompletionId();
  const requestOptions = resolveCompletionRequest(body, toolCallsEnabled);
  const toolSieve = requestOptions.toolNames.length
    ? createToolSieve(requestOptions.toolNames)
    : null;
  let toolCallIndex = 0;
  let sawToolCall = false;

  response.writeHead(200, {
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no"
  });
  response.flushHeaders?.();

  writeSseChunk(response, buildChunkPayload(
    completionId,
    requestOptions.model.id,
    { role: "assistant" }
  ));

  const emitToolCalls = (calls) => {
    if (!calls.length) {
      return;
    }

    sawToolCall = true;
    writeSseChunk(response, buildChunkPayload(
      completionId,
      requestOptions.model.id,
      { tool_calls: createChatToolCalls(calls, toolCallIndex) }
    ));
    toolCallIndex += calls.length;
  };

  const emitResponseText = (text) => {
    if (!toolSieve) {
      writeSseChunk(response, buildChunkPayload(
        completionId,
        requestOptions.model.id,
        { content: text }
      ));
      return;
    }

    const events = toolSieve.push(text);
    events.forEach((event) => {
      if (event.type === "tool_calls") {
        emitToolCalls(event.calls ?? []);
        return;
      }

      if (event.text) {
        writeSseChunk(response, buildChunkPayload(
          completionId,
          requestOptions.model.id,
          { content: event.text }
        ));
      }
    });
  };

  await streamCompletionContent({
    account,
    deleteAfterFinish,
    onDelta: (delta) => {
      if (delta.kind === "thinking") {
        writeSseChunk(response, buildChunkPayload(
          completionId,
          requestOptions.model.id,
          { reasoning_content: delta.text }
        ));
        return;
      }

      emitResponseText(delta.text);
    },
    requestOptions
  });

  if (toolSieve) {
    const tailEvents = toolSieve.flush();
    tailEvents.forEach((event) => {
      if (event.type === "tool_calls") {
        emitToolCalls(event.calls ?? []);
        return;
      }

      if (event.text) {
        writeSseChunk(response, buildChunkPayload(
          completionId,
          requestOptions.model.id,
          { content: event.text }
        ));
      }
    });
  }

  writeSseChunk(response, buildChunkPayload(
    completionId,
    requestOptions.model.id,
    {},
    sawToolCall ? "tool_calls" : "stop"
  ));
  response.end("data: [DONE]\n\n");
}

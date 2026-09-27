import { handleVercelOpenAiRequest } from "../src/vercel/openai-handler.js";

export default async function handler(request, response) {
  await handleVercelOpenAiRequest(request, response, "/models");
}

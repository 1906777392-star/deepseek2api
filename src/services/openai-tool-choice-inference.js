function latestMessageRole(messages = []) {
  return String(messages.at(-1)?.role ?? "").trim().toLowerCase();
}

export function inferToolChoiceForRequest(messages, _tools, suppliedChoice) {
  // Tool results are continuation turns. Kelivo may resend the previous
  // required/forced choice while returning a result, but the assistant must
  // be free to synthesize the answer or choose a different next tool.
  const role = latestMessageRole(messages);
  if (role === "tool" || role === "function") return "auto";

  // On fresh user turns, do not infer tool requirements from keywords.
  // Kelivo exposes the available tools and the model decides autonomously.
  return suppliedChoice ?? "auto";
}

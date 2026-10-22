import type { UnifiedChatRequest } from "@/types/llm";

/** Rough char-to-token estimate when upstream usage is not available yet. */
export function estimateTokens(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  return Math.ceil(chars / 4);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  try {
    return JSON.stringify(content) ?? "";
  } catch {
    return String(content);
  }
}

/** Estimate current-request prompt tokens from the Claude Code → CCR payload. */
export function estimateRequestPromptTokens(
  request: UnifiedChatRequest
): number {
  const parts: string[] = [];

  if (request.system) parts.push(contentToText(request.system));

  for (const msg of request.messages || []) {
    parts.push(contentToText(msg.content));
    if (msg.thinking?.content) parts.push(String(msg.thinking.content));
    if (msg.reasoning_content) parts.push(String(msg.reasoning_content));
    if (msg.tool_calls?.length) parts.push(JSON.stringify(msg.tool_calls));
  }

  if (request.tools?.length) parts.push(JSON.stringify(request.tools));

  return estimateTokens(parts.join("\n").length);
}

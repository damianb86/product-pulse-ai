import { PRODUCT_PULSE_CHATKIT_CLIENT_TOOL_NAME } from "./widgets";

export { PRODUCT_PULSE_CHATKIT_CLIENT_TOOL_NAME };

export interface ChatKitClientToolCall {
  name: string;
  params?: Record<string, unknown>;
}

export function getMessageFromChatKitClientToolCall(toolCall: ChatKitClientToolCall): string {
  const params = toolCall.params || {};
  return normalizeMessage(params.message || params.query || params.prompt);
}

export function normalizeMessage(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 3000);
}

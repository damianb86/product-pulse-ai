import type { AiPageContext } from "../chat/pageContext";
import type { AiEstimatedCost } from "./pricing";
import type { AiTokenUsage } from "./tokenUsage";

export const AI_TRACE_SCHEMA_VERSION = "product-pulse-ai-trace-v1";

export interface AiChatTrace {
  schemaVersion: typeof AI_TRACE_SCHEMA_VERSION;
  conversationId: string;
  messageId: string;
  userMessageId: string;
  shop: string;
  userId: string | null;
  model: string;
  instructionVersion: string;
  openAiResponseIds: string[];
  openAiCallCount: number;
  tokenUsage: AiTokenUsage | null;
  estimatedCost: AiEstimatedCost | null;
  toolCallCount: number;
  blockedToolCallCount: number;
  actionProposalCount: number;
  structuredResponse: {
    valid: boolean;
    retryCount: number;
    fallbackUsed: boolean;
  };
  guardrails: {
    maxToolCallsPerTurn: number;
    maxRecentMessages: number;
    recentMessagesSent: number;
    maxToolResultCharacters: number;
    maxOutputTokens: number | null;
    maxActionProposalsPerTurn: number;
  };
  pageContext: AiPageContext;
  durationMs: number;
  errorStatus: string | null;
  createdAt: string;
}

export function compactAiChatTraceForMetadata(trace: AiChatTrace): Omit<AiChatTrace, "shop" | "userId" | "pageContext"> {
  const safeTrace = { ...trace };
  delete (safeTrace as Partial<AiChatTrace>).shop;
  delete (safeTrace as Partial<AiChatTrace>).userId;
  delete (safeTrace as Partial<AiChatTrace>).pageContext;
  return safeTrace;
}

import OpenAI from "openai";

export interface OpenAiResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

export interface OpenAiResponseOutputItem {
  id?: string;
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface OpenAiResponseLike {
  id?: string;
  output?: OpenAiResponseOutputItem[];
  output_text?: string;
  usage?: OpenAiResponseUsage;
  [key: string]: unknown;
}

export type OpenAiResponsesCreateInput = Record<string, unknown>;

export interface OpenAiResponsesClient {
  responses: {
    create(input: OpenAiResponsesCreateInput): Promise<OpenAiResponseLike>;
  };
}

export function createOpenAiResponsesClient(env: NodeJS.ProcessEnv = process.env): OpenAiResponsesClient {
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for AI chat orchestration.");
  }
  return new OpenAI({ apiKey }) as unknown as OpenAiResponsesClient;
}

export interface AiTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
  raw: Record<string, unknown> | null;
}

export function normalizeOpenAiTokenUsage(value: unknown): AiTokenUsage | null {
  const record = asRecord(value);
  if (!record) return null;

  const inputDetails = asRecord(record.input_tokens_details) || asRecord(record.prompt_tokens_details);
  const outputDetails = asRecord(record.output_tokens_details) || asRecord(record.completion_tokens_details);
  const inputTokens = numberOrNull(record.input_tokens ?? record.prompt_tokens);
  const outputTokens = numberOrNull(record.output_tokens ?? record.completion_tokens);
  const cachedInputTokens = numberOrNull(
    record.cached_input_tokens
      ?? inputDetails?.cached_tokens
      ?? inputDetails?.cached_input_tokens,
  );
  const reasoningOutputTokens = numberOrNull(
    record.reasoning_tokens
      ?? outputDetails?.reasoning_tokens
      ?? outputDetails?.reasoning_output_tokens,
  );
  const totalTokens = numberOrNull(record.total_tokens)
    ?? sumIfKnown(inputTokens, outputTokens);

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningOutputTokens,
    totalTokens,
    raw: record,
  };
}

export function combineOpenAiTokenUsage(values: readonly unknown[]): AiTokenUsage | null {
  const usages = values
    .map(normalizeOpenAiTokenUsage)
    .filter(Boolean) as AiTokenUsage[];
  if (!usages.length) return null;

  return {
    inputTokens: sumNullable(usages.map((usage) => usage.inputTokens)),
    outputTokens: sumNullable(usages.map((usage) => usage.outputTokens)),
    cachedInputTokens: sumNullable(usages.map((usage) => usage.cachedInputTokens)),
    reasoningOutputTokens: sumNullable(usages.map((usage) => usage.reasoningOutputTokens)),
    totalTokens: sumNullable(usages.map((usage) => usage.totalTokens)),
    raw: {
      responseCount: usages.length,
      responses: usages.map((usage) => usage.raw),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

function sumNullable(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => typeof value === "number");
  if (!known.length) return null;
  return known.reduce((sum, value) => sum + value, 0);
}

function sumIfKnown(...values: Array<number | null>): number | null {
  if (values.some((value) => typeof value !== "number")) return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0);
}

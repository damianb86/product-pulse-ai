export function sanitizeJsonSchemaForOpenAi(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeJsonSchemaForOpenAi);
  if (!schema || typeof schema !== "object") return schema;

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "$schema" || key === "default") continue;
    sanitized[key] = sanitizeJsonSchemaForOpenAi(value);
  }
  return sanitized;
}

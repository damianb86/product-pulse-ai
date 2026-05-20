import { z } from "zod";
import type { AnyAiToolDefinition } from "../../domain/types";
import type { AiToolRegistry } from "../registry.server";
import { sanitizeJsonSchemaForOpenAi } from "./jsonSchema";

export interface OpenAiFunctionToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: unknown;
  strict: false;
}

export interface OpenAiToolAdapterResult {
  tools: OpenAiFunctionToolDefinition[];
  openAiNameToInternalName: Map<string, string>;
}

export function toOpenAiToolDefinitions(
  registryOrDefinitions: AiToolRegistry | AnyAiToolDefinition[],
): OpenAiFunctionToolDefinition[] {
  return toOpenAiToolAdapterResult(registryOrDefinitions).tools;
}

export function toOpenAiToolAdapterResult(
  registryOrDefinitions: AiToolRegistry | AnyAiToolDefinition[],
): OpenAiToolAdapterResult {
  const definitions = Array.isArray(registryOrDefinitions)
    ? registryOrDefinitions
    : registryOrDefinitions.listAiTools();
  const openAiNameToInternalName = new Map<string, string>();

  const tools: OpenAiFunctionToolDefinition[] = definitions
    .filter((definition) => definition.readOnly)
    .map((definition) => {
      const openAiName = toOpenAiSafeToolName(definition.name);
      openAiNameToInternalName.set(openAiName, definition.name);
      return {
        type: "function" as const,
        name: openAiName,
        description: definition.description,
        parameters: sanitizeJsonSchemaForOpenAi(z.toJSONSchema(definition.inputSchema)),
        strict: false as const,
      };
    });

  return { tools, openAiNameToInternalName };
}

function toOpenAiSafeToolName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

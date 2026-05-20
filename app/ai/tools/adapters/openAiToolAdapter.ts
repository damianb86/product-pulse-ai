import { z } from "zod";
import type { AnyAiToolDefinition } from "../../domain/types";
import type { AiToolRegistry } from "../registry.server";

export interface OpenAiToolDefinitionPlaceholder {
  type: "function";
  name: string;
  description: string;
  parameters: unknown;
  strict: boolean;
  metadata: {
    internalName: string;
    readOnly: true;
    category: string;
    permissionLevel: string;
  };
}

export function toOpenAiToolDefinitions(
  registryOrDefinitions: AiToolRegistry | AnyAiToolDefinition[],
): OpenAiToolDefinitionPlaceholder[] {
  const definitions = Array.isArray(registryOrDefinitions)
    ? registryOrDefinitions
    : registryOrDefinitions.listAiTools();

  return definitions.map((definition) => ({
    type: "function",
    name: toOpenAiSafeToolName(definition.name),
    description: definition.description,
    parameters: z.toJSONSchema(definition.inputSchema),
    strict: false,
    metadata: {
      internalName: definition.name,
      readOnly: definition.readOnly,
      category: definition.category,
      permissionLevel: definition.permissionLevel,
    },
  }));
}

function toOpenAiSafeToolName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

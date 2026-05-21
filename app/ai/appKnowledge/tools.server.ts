import { z } from "zod";
import type { AnyAiToolDefinition, AiToolDefinition } from "../domain/types";
import { AppKnowledgeRepository, normalizeKnowledgeLimit } from "./repository.server";
import { APP_KNOWLEDGE_TOPICS, type AppKnowledgeAudience } from "./types";

export const PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES = {
  searchAppKnowledge: "product_pulse_search_app_knowledge",
  getAppConceptExplanation: "product_pulse_get_app_concept_explanation",
  getScoreExplanation: "product_pulse_get_score_explanation",
  getScreenGuide: "product_pulse_get_screen_guide",
  getSettingExplanation: "product_pulse_get_setting_explanation",
} as const;

export interface AppKnowledgeToolDependencies {
  repository?: AppKnowledgeRepository;
}

const audienceSchema = z.enum(["merchant", "developer"]).optional().default("merchant");
const topicSchema = z.enum(APP_KNOWLEDGE_TOPICS).optional();
const limitSchema = z.coerce.number().int().optional();

const searchAppKnowledgeInputSchema = z.object({
  query: z.string().trim().min(1).max(240),
  topic: topicSchema,
  limit: limitSchema,
  audience: audienceSchema,
}).strict();

const conceptInputSchema = z.object({
  conceptName: z.string().trim().min(1).max(120),
  audience: audienceSchema,
}).strict();

const scoreInputSchema = z.object({
  scoreName: z.string().trim().min(1).max(120),
  audience: audienceSchema,
}).strict();

const screenInputSchema = z.object({
  screenName: z.string().trim().min(1).max(120),
  audience: audienceSchema,
}).strict();

const settingInputSchema = z.object({
  settingName: z.string().trim().min(1).max(160),
  audience: audienceSchema,
}).strict();

type SearchInput = z.infer<typeof searchAppKnowledgeInputSchema>;
type ConceptInput = z.infer<typeof conceptInputSchema>;
type ScoreInput = z.infer<typeof scoreInputSchema>;
type ScreenInput = z.infer<typeof screenInputSchema>;
type SettingInput = z.infer<typeof settingInputSchema>;

export function createAppKnowledgeToolDefinitions(
  dependencies: AppKnowledgeToolDependencies = {},
): AnyAiToolDefinition[] {
  const repository = dependencies.repository || new AppKnowledgeRepository();

  const searchTool: AiToolDefinition<SearchInput, ReturnType<AppKnowledgeRepository["search"]>> = {
    name: PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.searchAppKnowledge,
    description: "Search curated ProductPulse app knowledge for methodology, screen, scoring, setting, and workflow explanations.",
    inputSchema: searchAppKnowledgeInputSchema,
    readOnly: true,
    category: "app_knowledge",
    permissionLevel: "merchant",
    metadata: {
      resultType: "AppKnowledgeSearchResult",
      dataSources: ["docs/app-knowledge"],
      maxResultCount: 8,
      providerAgnostic: true,
    },
    async execute(_context, input) {
      const limit = normalizeKnowledgeLimit(input.limit);
      const result = repository.search({
        query: input.query,
        topic: input.topic,
        limit,
        audience: input.audience as AppKnowledgeAudience,
      });
      return {
        data: result,
        metadata: {
          resultCount: result.results.length,
          limit,
          dataFreshness: [{ source: "ProductPulse app knowledge", updatedAt: latestUpdatedAt(result.results) }],
        },
      };
    },
  };

  const conceptTool: AiToolDefinition<ConceptInput, ReturnType<AppKnowledgeRepository["getConceptExplanation"]>> = {
    name: PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getAppConceptExplanation,
    description: "Explain a real ProductPulse app concept such as QuickScan, Candidate, ProductAction, watchlist, or deep diagnosis.",
    inputSchema: conceptInputSchema,
    readOnly: true,
    category: "app_knowledge",
    permissionLevel: "merchant",
    metadata: {
      resultType: "AppConceptExplanation",
      dataSources: ["docs/app-knowledge"],
      maxResultCount: 1,
      providerAgnostic: true,
    },
    async execute(_context, input) {
      const result = repository.getConceptExplanation(input.conceptName, input.audience as AppKnowledgeAudience);
      return {
        data: result,
        metadata: {
          resultCount: result.found ? 1 : 0,
          dataFreshness: [{ source: "ProductPulse app knowledge", updatedAt: null }],
        },
      };
    },
  };

  const scoreTool: AiToolDefinition<ScoreInput, ReturnType<AppKnowledgeRepository["getScoreExplanation"]>> = {
    name: PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getScoreExplanation,
    description: "Explain a documented ProductPulse score or metric, including real formula, inputs, thresholds, interpretation, and caveats when known.",
    inputSchema: scoreInputSchema,
    readOnly: true,
    category: "app_knowledge",
    permissionLevel: "merchant",
    metadata: {
      resultType: "AppScoreExplanation",
      dataSources: ["docs/app-knowledge/scoring.md", "app/lib/product-pulse-scoring.js"],
      maxResultCount: 1,
      providerAgnostic: true,
    },
    async execute(_context, input) {
      const result = repository.getScoreExplanation(input.scoreName, input.audience as AppKnowledgeAudience);
      return {
        data: result,
        metadata: {
          resultCount: result.found ? 1 : 0,
          dataFreshness: [{ source: "ProductPulse app knowledge", updatedAt: null }],
        },
      };
    },
  };

  const screenTool: AiToolDefinition<ScreenInput, ReturnType<AppKnowledgeRepository["getScreenGuide"]>> = {
    name: PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getScreenGuide,
    description: "Explain how to read and use a real ProductPulse screen such as Dashboard, Products, Product detail, Watchlist, Analytics, or Settings.",
    inputSchema: screenInputSchema,
    readOnly: true,
    category: "app_knowledge",
    permissionLevel: "merchant",
    metadata: {
      resultType: "AppScreenGuide",
      dataSources: ["docs/app-knowledge"],
      maxResultCount: 1,
      providerAgnostic: true,
    },
    async execute(_context, input) {
      const result = repository.getScreenGuide(input.screenName, input.audience as AppKnowledgeAudience);
      return {
        data: result,
        metadata: {
          resultCount: result.found ? 1 : 0,
          dataFreshness: [{ source: "ProductPulse app knowledge", updatedAt: null }],
        },
      };
    },
  };

  const settingTool: AiToolDefinition<SettingInput, ReturnType<AppKnowledgeRepository["getSettingExplanation"]>> = {
    name: PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getSettingExplanation,
    description: "Explain a documented ProductPulse setting, including allowed values, default, effect, and caveats.",
    inputSchema: settingInputSchema,
    readOnly: true,
    category: "app_knowledge",
    permissionLevel: "merchant",
    metadata: {
      resultType: "AppSettingExplanation",
      dataSources: ["docs/app-knowledge/settings.md", "app/lib/product-pulse-settings.server.js"],
      maxResultCount: 1,
      providerAgnostic: true,
    },
    async execute(_context, input) {
      const result = repository.getSettingExplanation(input.settingName, input.audience as AppKnowledgeAudience);
      return {
        data: result,
        metadata: {
          resultCount: result.found ? 1 : 0,
          dataFreshness: [{ source: "ProductPulse app knowledge", updatedAt: null }],
        },
      };
    },
  };

  return [
    searchTool,
    conceptTool,
    scoreTool,
    screenTool,
    settingTool,
  ] as unknown as AnyAiToolDefinition[];
}

function latestUpdatedAt(results: Array<{ lastUpdated?: string }>): string | null {
  return results.map((result) => result.lastUpdated).filter(Boolean).sort().at(-1) || null;
}

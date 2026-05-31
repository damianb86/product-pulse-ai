import { z } from "zod";
import type { AnyAiToolDefinition, AiToolDefinition } from "../domain/types";
import { AppInteractionGuidanceRepository, normalizeGuidanceLimit } from "./interactionGuidance.server";
import { AppKnowledgeRepository, normalizeKnowledgeLimit } from "./repository.server";
import {
  APP_INTERACTION_GUIDANCE_INTENTS,
  APP_KNOWLEDGE_TOPICS,
  type AppInteractionGuidanceIntent,
  type AppKnowledgeAudience,
} from "./types";

export const PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES = {
  searchAppKnowledge: "product_pulse_search_app_knowledge",
  getAppConceptExplanation: "product_pulse_get_app_concept_explanation",
  getScoreExplanation: "product_pulse_get_score_explanation",
  getScreenGuide: "product_pulse_get_screen_guide",
  getSettingExplanation: "product_pulse_get_setting_explanation",
  getInteractionGuidance: "product_pulse_get_interaction_guidance",
  searchProductDetailCards: "product_pulse_search_product_detail_cards",
  getProductDetailCardExplanation: "product_pulse_get_product_detail_card_explanation",
} as const;

export interface AppKnowledgeToolDependencies {
  repository?: AppKnowledgeRepository;
  interactionGuidanceRepository?: AppInteractionGuidanceRepository;
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

const productDetailCardSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(240),
  limit: limitSchema,
  audience: audienceSchema,
}).strict();

const productDetailCardInputSchema = z.object({
  cardName: z.string().trim().min(1).max(160),
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

const interactionGuidanceInputSchema = z.object({
  query: z.string().trim().min(1).max(500).optional(),
  intent: z.enum(APP_INTERACTION_GUIDANCE_INTENTS).optional(),
  pageType: z.string().trim().max(80).optional(),
  hasProductContext: z.boolean().optional(),
  limit: limitSchema,
}).strict();

type SearchInput = z.infer<typeof searchAppKnowledgeInputSchema>;
type ConceptInput = z.infer<typeof conceptInputSchema>;
type ScoreInput = z.infer<typeof scoreInputSchema>;
type ProductDetailCardSearchInput = z.infer<typeof productDetailCardSearchInputSchema>;
type ProductDetailCardInput = z.infer<typeof productDetailCardInputSchema>;
type ScreenInput = z.infer<typeof screenInputSchema>;
type SettingInput = z.infer<typeof settingInputSchema>;
type InteractionGuidanceInput = z.infer<typeof interactionGuidanceInputSchema>;

export function createAppKnowledgeToolDefinitions(
  dependencies: AppKnowledgeToolDependencies = {},
): AnyAiToolDefinition[] {
  const repository = dependencies.repository || new AppKnowledgeRepository();
  const interactionGuidanceRepository = dependencies.interactionGuidanceRepository || new AppInteractionGuidanceRepository();

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
    description: "Explain a real ProductPulse app concept such as Catalog Scan, Candidate, ProductAction, watchlist, or product diagnosis.",
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

  const productDetailCardSearchTool: AiToolDefinition<
    ProductDetailCardSearchInput,
    ReturnType<AppKnowledgeRepository["searchProductDetailCards"]>
  > = {
    name: PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.searchProductDetailCards,
    description: "Search curated explanations for ProductPulse Product Detail cards, visible metric tiles, relationship panels, and card titles.",
    inputSchema: productDetailCardSearchInputSchema,
    readOnly: true,
    category: "app_knowledge",
    permissionLevel: "merchant",
    metadata: {
      resultType: "AppProductDetailCardSearchResult",
      dataSources: ["docs/app-knowledge/product-detail-cards.md", "app/components/ProductPulseScreens.jsx"],
      maxResultCount: 8,
      providerAgnostic: true,
    },
    async execute(_context, input) {
      const limit = normalizeKnowledgeLimit(input.limit);
      const result = repository.searchProductDetailCards({
        query: input.query,
        limit,
        audience: input.audience as AppKnowledgeAudience,
      });
      return {
        data: result,
        metadata: {
          resultCount: result.results.length,
          limit,
          dataFreshness: [{ source: "ProductPulse product detail card knowledge", updatedAt: null }],
        },
      };
    },
  };

  const productDetailCardTool: AiToolDefinition<
    ProductDetailCardInput,
    ReturnType<AppKnowledgeRepository["getProductDetailCardExplanation"]>
  > = {
    name: PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getProductDetailCardExplanation,
    description: "Explain one ProductPulse Product Detail card or metric title, including purpose, formula, inputs, interpretation, and caveats.",
    inputSchema: productDetailCardInputSchema,
    readOnly: true,
    category: "app_knowledge",
    permissionLevel: "merchant",
    metadata: {
      resultType: "AppProductDetailCardExplanation",
      dataSources: ["docs/app-knowledge/product-detail-cards.md", "docs/product-relationship-intelligence-metrics.md"],
      maxResultCount: 1,
      providerAgnostic: true,
    },
    async execute(_context, input) {
      const result = repository.getProductDetailCardExplanation(
        input.cardName,
        input.audience as AppKnowledgeAudience,
      );
      return {
        data: result,
        metadata: {
          resultCount: result.found ? 1 : 0,
          dataFreshness: [{ source: "ProductPulse product detail card knowledge", updatedAt: null }],
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

  const interactionGuidanceTool: AiToolDefinition<
    InteractionGuidanceInput,
    ReturnType<AppInteractionGuidanceRepository["getGuidance"]>
  > = {
    name: PRODUCT_PULSE_APP_KNOWLEDGE_TOOL_NAMES.getInteractionGuidance,
    description: "Return ProductPulse assistant guidance for ambiguous user requests, including supported next-step options and example prompts.",
    inputSchema: interactionGuidanceInputSchema,
    readOnly: true,
    category: "app_knowledge",
    permissionLevel: "merchant",
    metadata: {
      resultType: "AppInteractionGuidance",
      dataSources: ["docs/app-knowledge/interaction-guidance.md", "registered AI tools/actions/mutations"],
      maxResultCount: 6,
      providerAgnostic: true,
    },
    async execute(_context, input) {
      const result = interactionGuidanceRepository.getGuidance({
        query: input.query,
        intent: input.intent as AppInteractionGuidanceIntent | undefined,
        pageType: input.pageType,
        hasProductContext: input.hasProductContext,
        limit: input.limit,
      });
      return {
        data: result,
        metadata: {
          resultCount: result.options.length,
          limit: normalizeGuidanceLimit(input.limit),
          dataFreshness: [{ source: "ProductPulse assistant guidance", updatedAt: null }],
        },
      };
    },
  };

  return [
    searchTool,
    conceptTool,
    scoreTool,
    productDetailCardSearchTool,
    productDetailCardTool,
    screenTool,
    settingTool,
    interactionGuidanceTool,
  ] as unknown as AnyAiToolDefinition[];
}

function latestUpdatedAt(results: Array<{ lastUpdated?: string }>): string | null {
  return results.map((result) => result.lastUpdated).filter(Boolean).sort().at(-1) || null;
}

import { z } from "zod";
import type { AiProductRiskDetail, AiToolContext } from "../domain/types";
import {
  ProductPulseAiRepository,
} from "../repositories/productPulseAiRepository.server";
import type { AnyAiActionDefinition, AiActionExecutionResult } from "./types";
import {
  queueProductDiagnosisForShop,
  runSelectedProductDiagnosesForShop,
  recordProductDetailActionForShop,
  deleteProductAnalysisForShop,
} from "../../lib/product-pulse-jobs.server";
import {
  addWatchedProductForShop,
  removeWatchedProductForShop,
  getActiveWatchedProductsForShop,
} from "../../lib/product-pulse-watchlist.server";

export const PRODUCT_PULSE_AI_ACTION_NAMES = {
  runProductDiagnosis: "product_pulse_run_product_diagnosis",
  addToWatchlist: "product_pulse_add_to_watchlist",
  removeFromWatchlist: "product_pulse_remove_from_watchlist",
  runWatchlistDiagnoses: "product_pulse_run_watchlist_diagnoses",
  markRecommendedAction: "product_pulse_mark_recommended_action",
  archiveInternalProductAnalysis: "product_pulse_archive_internal_product_analysis",
} as const;

export interface ProductPulseAiActionDependencies {
  productRepository?: ProductPulseAiRepository;
  services?: Partial<{
    queueProductDiagnosisForShop: typeof queueProductDiagnosisForShop;
    runSelectedProductDiagnosesForShop: typeof runSelectedProductDiagnosesForShop;
    recordProductDetailActionForShop: typeof recordProductDetailActionForShop;
    deleteProductAnalysisForShop: typeof deleteProductAnalysisForShop;
    addWatchedProductForShop: typeof addWatchedProductForShop;
    removeWatchedProductForShop: typeof removeWatchedProductForShop;
    getActiveWatchedProductsForShop: typeof getActiveWatchedProductsForShop;
  }>;
}

const productReferenceFields = {
  productRef: z.string().trim().min(1).max(320).optional(),
  productGid: z.string().trim().min(1).max(320).optional(),
  handle: z.string().trim().min(1).max(320).optional(),
};

const productRefSchema = z.object({
  ...productReferenceFields,
  reason: z.string().trim().max(500).optional(),
}).strict().superRefine(requireProductReference);

const emptyActionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
}).strict();

const markRecommendedActionSchema = z.object({
  ...productReferenceFields,
  actionId: z.string().trim().min(1).max(160),
  status: z.enum(["dismissed", "reviewed", "active"]),
  reason: z.string().trim().max(500).optional(),
}).strict().superRefine(requireProductReference);

type ProductRefActionInput = z.infer<typeof productRefSchema>;
type EmptyActionInput = z.infer<typeof emptyActionSchema>;
type MarkRecommendedActionInput = z.infer<typeof markRecommendedActionSchema>;

function requireProductReference(input: Record<string, unknown>, ctx: z.RefinementCtx) {
  if (getProductReference(input)) return;
  ctx.addIssue({
    code: "custom",
    path: ["productRef"],
    message: "Provide productRef, productGid, or handle.",
  });
}

function getProductReference(input: Record<string, unknown>): string {
  return String(input.productRef || input.productGid || input.handle || "").trim();
}

function normalizeProductRefInput(input: ProductRefActionInput, canonicalProductGid: string): ProductRefActionInput {
  return {
    productRef: canonicalProductGid || getProductReference(input),
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

function normalizeMarkRecommendedActionInput(
  input: MarkRecommendedActionInput,
  canonicalProductGid: string,
): MarkRecommendedActionInput {
  return {
    productRef: canonicalProductGid || getProductReference(input),
    actionId: input.actionId,
    status: input.status,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

export function createProductPulseAiActionDefinitions(
  dependencies: ProductPulseAiActionDependencies = {},
): AnyAiActionDefinition[] {
  const productRepository = dependencies.productRepository || new ProductPulseAiRepository();
  const services = {
    queueProductDiagnosisForShop,
    runSelectedProductDiagnosesForShop,
    recordProductDetailActionForShop,
    deleteProductAnalysisForShop,
    addWatchedProductForShop,
    removeWatchedProductForShop,
    getActiveWatchedProductsForShop,
    ...dependencies.services,
  };

  return [
    {
      actionName: PRODUCT_PULSE_AI_ACTION_NAMES.runProductDiagnosis,
      category: "diagnosis",
      description: "Queue an internal ProductPulse product diagnosis job for one stored product.",
      inputSchema: productRefSchema,
      confirmationLevel: "low",
      sideEffectLevel: "medium",
      reversible: false,
      requiresEntityOwnershipCheck: true,
      async buildProposal(context, input: ProductRefActionInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        return {
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.runProductDiagnosis,
          category: "diagnosis",
          targetType: "product",
          targetId: product.productGid,
          targetLabel: product.title,
          proposedInput: normalizeProductRefInput(input, product.productGid),
          title: "Run ProductPulse diagnosis",
          summary: `Queue a new internal diagnosis job for ${product.title}.`,
          reason: input.reason || product.primaryIssue || null,
          expectedResult: "ProductPulse will create or reuse an internal diagnosis job. No Shopify product fields will be changed.",
          risks: ["This can consume diagnosis capacity and may update ProductPulse analysis when the job finishes."],
          confirmationLevel: "low",
          sideEffectLevel: "medium",
          reversible: false,
          requiresEntityOwnershipCheck: true,
          expiresAt: getProposalExpiry(),
        };
      },
      async execute(context, proposal) {
        const input = productRefSchema.parse(proposal.proposedInput);
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const result = await services.queueProductDiagnosisForShop(context.shop, product.productGid);
        return serviceResultToExecutionResult({
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.runProductDiagnosis,
          result,
          successSummary: `Diagnosis queued for ${product.title}.`,
          affectedEntities: [productEntity(product)],
          createdJobId: result?.job?.id || null,
        });
      },
    },
    {
      actionName: PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
      category: "watchlist",
      description: "Add one stored ProductPulse product to the app watchlist.",
      inputSchema: productRefSchema,
      confirmationLevel: "low",
      sideEffectLevel: "low",
      reversible: true,
      requiresEntityOwnershipCheck: true,
      async buildProposal(context, input: ProductRefActionInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        return {
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
          category: "watchlist",
          targetType: "product",
          targetId: product.productGid,
          targetLabel: product.title,
          proposedInput: normalizeProductRefInput(input, product.productGid),
          title: "Add to ProductPulse watchlist",
          summary: `Add ${product.title} to the app watchlist.`,
          reason: input.reason || product.primaryIssue || null,
          expectedResult: "ProductPulse will create a watchlist row and activity record. Shopify product data will not be changed.",
          risks: ["The watchlist supports up to 50 products, so this may fail if it is full."],
          confirmationLevel: "low",
          sideEffectLevel: "low",
          reversible: true,
          requiresEntityOwnershipCheck: true,
          expiresAt: getProposalExpiry(),
        };
      },
      async execute(context, proposal) {
        const input = productRefSchema.parse(proposal.proposedInput);
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const result = await services.addWatchedProductForShop(context.shop, {
          productGid: product.productGid,
          title: product.title,
          handle: product.handle || "",
        });
        return serviceResultToExecutionResult({
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
          result,
          successSummary: `${product.title} added to the ProductPulse watchlist.`,
          affectedEntities: [productEntity(product), { type: "watchlist", id: product.productGid, label: product.title }],
        });
      },
    },
    {
      actionName: PRODUCT_PULSE_AI_ACTION_NAMES.removeFromWatchlist,
      category: "watchlist",
      description: "Remove one product from the app watchlist.",
      inputSchema: productRefSchema,
      confirmationLevel: "medium",
      sideEffectLevel: "medium",
      reversible: true,
      requiresEntityOwnershipCheck: true,
      async buildProposal(context, input: ProductRefActionInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        return {
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.removeFromWatchlist,
          category: "watchlist",
          targetType: "product",
          targetId: product.productGid,
          targetLabel: product.title,
          proposedInput: normalizeProductRefInput(input, product.productGid),
          title: "Remove from ProductPulse watchlist",
          summary: `Remove ${product.title} from the app watchlist.`,
          reason: input.reason || null,
          expectedResult: "ProductPulse will delete the watchlist row and record activity. Shopify product data will not be changed.",
          risks: ["Future watchlist scans will no longer include this product until it is added again."],
          confirmationLevel: "medium",
          sideEffectLevel: "medium",
          reversible: true,
          requiresEntityOwnershipCheck: true,
          expiresAt: getProposalExpiry(),
        };
      },
      async execute(context, proposal) {
        const input = productRefSchema.parse(proposal.proposedInput);
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const result = await services.removeWatchedProductForShop(context.shop, product.productGid);
        return serviceResultToExecutionResult({
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.removeFromWatchlist,
          result,
          successSummary: `${product.title} removed from the ProductPulse watchlist.`,
          affectedEntities: [productEntity(product), { type: "watchlist", id: product.productGid, label: product.title }],
        });
      },
    },
    {
      actionName: PRODUCT_PULSE_AI_ACTION_NAMES.runWatchlistDiagnoses,
      category: "watchlist",
      description: "Queue internal diagnosis jobs for active watched products.",
      inputSchema: emptyActionSchema,
      confirmationLevel: "low",
      sideEffectLevel: "medium",
      reversible: false,
      requiresEntityOwnershipCheck: false,
      async buildProposal(context, input: EmptyActionInput) {
        const products = await services.getActiveWatchedProductsForShop(context.shop);
        return {
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.runWatchlistDiagnoses,
          category: "watchlist",
          targetType: "watchlist",
          targetId: "active-watchlist",
          targetLabel: "Active watchlist",
          proposedInput: input,
          title: "Run watchlist diagnostics",
          summary: `Queue internal diagnosis jobs for ${products.length} active watched product${products.length === 1 ? "" : "s"}.`,
          reason: input.reason || "Refresh watched product risk with current ProductPulse data.",
          expectedResult: "ProductPulse will create diagnosis jobs for active watched products. Shopify product data will not be changed.",
          risks: ["This can consume diagnosis capacity and may update ProductPulse analysis when jobs finish."],
          confirmationLevel: "low",
          sideEffectLevel: "medium",
          reversible: false,
          requiresEntityOwnershipCheck: false,
          expiresAt: getProposalExpiry(),
        };
      },
      async execute(context, proposal) {
        emptyActionSchema.parse(proposal.proposedInput);
        const watchedProducts = await services.getActiveWatchedProductsForShop(context.shop) as Array<{
          productGid: string;
          productTitle?: string | null;
        }>;
        const productIds = watchedProducts.map((product) => product.productGid).filter(Boolean);
        const result = await services.runSelectedProductDiagnosesForShop(context.shop, productIds);
        return serviceResultToExecutionResult({
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.runWatchlistDiagnoses,
          result,
          successSummary: `${result?.queuedCount || productIds.length} watchlist diagnosis job${(result?.queuedCount || productIds.length) === 1 ? "" : "s"} queued.`,
          affectedEntities: watchedProducts.map((product) => ({
            type: "product",
            id: product.productGid,
            label: product.productTitle,
          })),
          createdJobId: result?.jobs?.[0]?.id || null,
        });
      },
    },
    {
      actionName: PRODUCT_PULSE_AI_ACTION_NAMES.markRecommendedAction,
      category: "recommendation",
      description: "Mark a ProductPulse recommended internal action as dismissed, reviewed, or active.",
      inputSchema: markRecommendedActionSchema,
      confirmationLevel: "medium",
      sideEffectLevel: "medium",
      reversible: true,
      requiresEntityOwnershipCheck: true,
      async buildProposal(context, input: MarkRecommendedActionInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const recommendation = findRecommendation(product, input.actionId);
        if (!recommendation) {
          throw new Error("Recommended action was not found for this product.");
        }
        const recommendationIssue = "issue" in recommendation ? recommendation.issue : null;
        return {
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.markRecommendedAction,
          category: "recommendation",
          targetType: "product_action",
          targetId: `${product.productGid}:${input.actionId}`,
          targetLabel: recommendation.label,
          proposedInput: normalizeMarkRecommendedActionInput(input, product.productGid),
          title: `Mark recommendation as ${input.status}`,
          summary: `Mark "${recommendation.label}" as ${input.status} for ${product.title}.`,
          reason: input.reason || recommendationIssue || null,
          expectedResult: "ProductPulse will record the recommendation status internally. Shopify product fields will not be changed.",
          risks: ["This changes how ProductPulse displays and counts this recommendation."],
          confirmationLevel: "medium",
          sideEffectLevel: "medium",
          reversible: true,
          requiresEntityOwnershipCheck: true,
          expiresAt: getProposalExpiry(),
        };
      },
      async execute(context, proposal) {
        const input = markRecommendedActionSchema.parse(proposal.proposedInput);
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const result = await services.recordProductDetailActionForShop(context.shop, product.productGid, input.actionId, {
          actionStatus: input.status,
        });
        return serviceResultToExecutionResult({
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.markRecommendedAction,
          result,
          successSummary: `Recommendation status updated for ${product.title}.`,
          affectedEntities: [productEntity(product), { type: "product_action", id: input.actionId }],
        });
      },
    },
    {
      actionName: PRODUCT_PULSE_AI_ACTION_NAMES.archiveInternalProductAnalysis,
      category: "tracking",
      description: "Remove app-owned ProductPulse analysis and tracking records for one stored product. Does not delete the Shopify product.",
      inputSchema: productRefSchema,
      confirmationLevel: "high",
      sideEffectLevel: "high",
      reversible: false,
      requiresEntityOwnershipCheck: true,
      async buildProposal(context, input: ProductRefActionInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        return {
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.archiveInternalProductAnalysis,
          category: "tracking",
          targetType: "product",
          targetId: product.productGid,
          targetLabel: product.title,
          proposedInput: normalizeProductRefInput(input, product.productGid),
          title: "Remove ProductPulse analysis",
          summary: `Remove ProductPulse analysis and tracking records for ${product.title}.`,
          reason: input.reason || null,
          expectedResult: "ProductPulse will delete app-owned analysis records. The Shopify product will not be deleted or changed.",
          risks: [
            "This removes ProductPulse snapshots, diagnoses, recommendation records, score history, watchlist activity, and related internal job records.",
            "This cannot be undone from the AI assistant.",
          ],
          confirmationLevel: "high",
          sideEffectLevel: "high",
          reversible: false,
          requiresEntityOwnershipCheck: true,
          expiresAt: getProposalExpiry(),
        };
      },
      async execute(context, proposal) {
        const input = productRefSchema.parse(proposal.proposedInput);
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const result = await services.deleteProductAnalysisForShop(context.shop, product.productGid);
        return serviceResultToExecutionResult({
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.archiveInternalProductAnalysis,
          result,
          successSummary: `ProductPulse analysis removed for ${product.title}.`,
          affectedEntities: [productEntity(product)],
          updatedData: result?.deleted,
        });
      },
    },
  ] as AnyAiActionDefinition[];
}

async function requireProduct(
  context: AiToolContext,
  repository: ProductPulseAiRepository,
  productRef: string,
): Promise<AiProductRiskDetail> {
  const product = await repository.getProductRiskDetail(context, productRef, {
    evidenceLimit: 3,
    issueLimit: 5,
    recommendationLimit: 10,
    actionLimit: 10,
    historyLimit: 3,
  });
  if (!product) {
    throw new Error("ProductPulse does not have a stored product record for that product.");
  }
  return product;
}

function findRecommendation(product: AiProductRiskDetail, actionId: string) {
  const recommendations = product.diagnosis?.recommendations || [];
  return recommendations.find((recommendation) => recommendation.id === actionId)
    || product.actionHistory.find((action) => action.id === actionId || action.actionType === actionId)
    || null;
}

function productEntity(product: AiProductRiskDetail) {
  return {
    type: "product",
    id: product.productGid,
    label: product.title,
  };
}

function serviceResultToExecutionResult(input: {
  actionName: string;
  result: Record<string, unknown> | null | undefined;
  successSummary: string;
  affectedEntities: AiActionExecutionResult["affectedEntities"];
  createdJobId?: string | null;
  updatedData?: unknown;
}): AiActionExecutionResult {
  const status = input.result?.status === "success" ? "success" : "error";
  const message = status === "success"
    ? String(input.result?.message || input.successSummary)
    : "ProductPulse could not complete that action.";
  return {
    actionName: input.actionName,
    status,
    summary: status === "success" ? input.successSummary : message,
    affectedEntities: input.affectedEntities,
    createdJobId: input.createdJobId || null,
    updatedData: status === "success" ? input.updatedData || input.result : undefined,
    safeMessage: message,
  };
}

function getProposalExpiry(): Date {
  return new Date(Date.now() + 15 * 60 * 1000);
}

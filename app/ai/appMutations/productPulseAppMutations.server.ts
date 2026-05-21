import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import prisma from "../../db.server";
import type { AiProductRiskDetail, AiToolContext } from "../domain/types";
import { AiToolExecutionError } from "../domain/errors";
import { ProductPulseAiRepository } from "../repositories/productPulseAiRepository.server";
import type {
  AnyAiAppMutationDefinition,
  AiAppMutationEditableField,
  AiAppMutationProposal,
  AiAppMutationSaveResult,
} from "./types";

export const PRODUCT_PULSE_AI_APP_MUTATION_NAMES = {
  createProductDescriptionDraft: "product_pulse_create_product_description_draft",
  createSeoDraft: "product_pulse_create_seo_draft",
  createMetafieldValueDraft: "product_pulse_create_metafield_value_draft",
  createRecommendedAction: "product_pulse_create_recommended_action",
  markRecommendedActionStatus: "product_pulse_mark_recommended_action_status",
} as const;

type ProductPulseAppMutationDbClient = Pick<PrismaClient, "productAction" | "productDiagnosis">;

export interface ProductPulseAiAppMutationDependencies {
  productRepository?: ProductPulseAiRepository;
  db?: ProductPulseAppMutationDbClient;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

const productReferenceFields = {
  productRef: z.string().trim().min(1).max(320).optional(),
  productGid: z.string().trim().min(1).max(320).optional(),
  handle: z.string().trim().min(1).max(320).optional(),
};

const productDescriptionDraftSchema = z.object({
  ...productReferenceFields,
  text: z.string().trim().min(1).max(5000).optional(),
  draftText: z.string().trim().min(1).max(5000).optional(),
  proposedText: z.string().trim().min(1).max(5000).optional(),
  reason: z.string().trim().max(700).optional(),
  sourceRecommendationId: z.string().trim().max(160).optional(),
}).strict().superRefine(requireProductReference).superRefine(requireDraftText);

const seoDraftSchema = z.object({
  ...productReferenceFields,
  seoTitle: z.string().trim().min(1).max(90).optional(),
  seoDescription: z.string().trim().min(1).max(220).optional(),
  reason: z.string().trim().max(700).optional(),
  sourceRecommendationId: z.string().trim().max(160).optional(),
}).strict().superRefine(requireProductReference).superRefine((input, ctx) => {
  if (input.seoTitle || input.seoDescription) return;
  ctx.addIssue({ code: "custom", path: ["seoTitle"], message: "Provide seoTitle or seoDescription." });
});

const metafieldDraftSchema = z.object({
  ...productReferenceFields,
  namespace: z.string().trim().min(1).max(120),
  key: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(120),
  value: z.string().trim().min(1).max(8000),
  label: z.string().trim().max(160).optional(),
  reason: z.string().trim().max(700).optional(),
}).strict().superRefine(requireProductReference);

const createRecommendedActionSchema = z.object({
  ...productReferenceFields,
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(3).max(800),
  priority: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["draft", "active", "reviewed"]).optional(),
  reason: z.string().trim().max(700).optional(),
  sourceRecommendationId: z.string().trim().max(160).optional(),
}).strict().superRefine(requireProductReference);

const markRecommendedActionStatusSchema = z.object({
  ...productReferenceFields,
  actionId: z.string().trim().min(1).max(160),
  status: z.enum(["active", "reviewed", "dismissed", "completed"]),
  reason: z.string().trim().max(700).optional(),
}).strict().superRefine(requireProductReference);

const textEditableSchema = z.object({
  text: z.string().trim().min(1).max(5000),
}).strict();

const seoEditableSchema = z.object({
  seoTitle: z.string().trim().max(90).optional(),
  seoDescription: z.string().trim().max(220).optional(),
}).strict().superRefine((input, ctx) => {
  if (input.seoTitle || input.seoDescription) return;
  ctx.addIssue({ code: "custom", path: ["seoTitle"], message: "Provide seoTitle or seoDescription." });
});

const metafieldEditableSchema = z.object({
  value: z.string().trim().min(1).max(8000),
}).strict();

const recommendationEditableSchema = z.object({
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(3).max(800),
  priority: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["draft", "active", "reviewed"]).optional(),
}).strict();

const recommendationStatusEditableSchema = z.object({
  status: z.enum(["active", "reviewed", "dismissed", "completed"]),
  reason: z.string().trim().max(700).optional(),
}).strict();

type ProductDescriptionDraftInput = z.infer<typeof productDescriptionDraftSchema>;
type SeoDraftInput = z.infer<typeof seoDraftSchema>;
type MetafieldDraftInput = z.infer<typeof metafieldDraftSchema>;
type CreateRecommendedActionInput = z.infer<typeof createRecommendedActionSchema>;
type MarkRecommendedActionStatusInput = z.infer<typeof markRecommendedActionStatusSchema>;

export function createProductPulseAiAppMutationDefinitions(
  dependencies: ProductPulseAiAppMutationDependencies = {},
): AnyAiAppMutationDefinition[] {
  const productRepository = dependencies.productRepository || new ProductPulseAiRepository();
  const db = dependencies.db || prisma as unknown as ProductPulseAppMutationDbClient;
  const env = dependencies.env || process.env;

  return [
    {
      mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductDescriptionDraft,
      category: "draft",
      targetType: "product",
      description: "Create an editable ProductPulse-only product description draft. This does not update Shopify.",
      inputSchema: productDescriptionDraftSchema,
      editableDraftSchema: textEditableSchema,
      requiredPermission: "merchant",
      confirmationLevel: "medium",
      sideEffectLevel: "low",
      reversible: true,
      allowedFields: ["text"],
      blockedFields: blockedShopifyFields(),
      async buildProposal(context, input: ProductDescriptionDraftInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const text = getDraftText(input);
        return baseDraftProposal({
          mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductDescriptionDraft,
          product,
          input: normalizeProductInput(input, product.productGid, { text }),
          draftType: "product_description",
          title: "Save product description draft",
          summary: `Save an editable description draft for ${product.title} inside ProductPulse only.`,
          proposedValue: { text },
          generatedReason: input.reason || product.primaryIssue || null,
          editableFields: [textareaField("text", "Draft description", text, 5000)],
          allowedFields: ["text"],
          expiresAt: getProposalExpiry(),
        });
      },
      async save(_context, proposal, editable) {
        const fields = textEditableSchema.parse(editable);
        return savedDraftResult(proposal, fields, "Product description draft saved in ProductPulse.");
      },
    },
    {
      mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createSeoDraft,
      category: "draft",
      targetType: "product",
      description: "Create editable SEO title/description draft fields inside ProductPulse only. This does not update Shopify.",
      inputSchema: seoDraftSchema,
      editableDraftSchema: seoEditableSchema,
      requiredPermission: "merchant",
      confirmationLevel: "medium",
      sideEffectLevel: "low",
      reversible: true,
      allowedFields: ["seoTitle", "seoDescription"],
      blockedFields: blockedShopifyFields(),
      async buildProposal(context, input: SeoDraftInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const proposedValue = {
          seoTitle: input.seoTitle || "",
          seoDescription: input.seoDescription || "",
        };
        return baseDraftProposal({
          mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createSeoDraft,
          product,
          input: normalizeProductInput(input, product.productGid, proposedValue),
          draftType: "seo",
          title: "Save SEO draft",
          summary: `Save SEO draft text for ${product.title} inside ProductPulse only.`,
          proposedValue,
          generatedReason: input.reason || product.primaryIssue || null,
          editableFields: [
            textField("seoTitle", "SEO title", proposedValue.seoTitle, 90, false),
            textareaField("seoDescription", "SEO description", proposedValue.seoDescription, 220, false),
          ],
          allowedFields: ["seoTitle", "seoDescription"],
          expiresAt: getProposalExpiry(),
        });
      },
      async save(_context, proposal, editable) {
        const fields = seoEditableSchema.parse(editable);
        return savedDraftResult(proposal, fields, "SEO draft saved in ProductPulse.");
      },
    },
    {
      mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createMetafieldValueDraft,
      category: "draft",
      targetType: "product",
      description: "Create an editable allowlisted metafield value draft inside ProductPulse only. This does not update Shopify.",
      inputSchema: metafieldDraftSchema,
      editableDraftSchema: metafieldEditableSchema,
      requiredPermission: "merchant",
      confirmationLevel: "medium",
      sideEffectLevel: "low",
      reversible: true,
      allowedFields: ["value"],
      blockedFields: blockedShopifyFields(),
      async buildProposal(context, input: MetafieldDraftInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const allowlist = getAllowedMetafieldDrafts(env);
        const allowed = allowlist.find((item) => (
          item.namespace === input.namespace && item.key === input.key && item.type === input.type
        ));
        if (!allowed) {
          throw new AiToolExecutionError(
            "METAFIELD_DRAFT_NOT_ALLOWLISTED",
            "That metafield is not allowlisted for AI app-only drafts.",
          );
        }
        return baseDraftProposal({
          mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createMetafieldValueDraft,
          product,
          input: normalizeProductInput(input, product.productGid, {
            namespace: input.namespace,
            key: input.key,
            type: input.type,
            value: input.value,
          }),
          draftType: "metafield_value",
          title: "Save metafield draft",
          summary: `Save a ${allowed.label || `${input.namespace}.${input.key}`} draft for ${product.title} inside ProductPulse only.`,
          proposedValue: {
            namespace: input.namespace,
            key: input.key,
            type: input.type,
            value: input.value,
            label: input.label || allowed.label || `${input.namespace}.${input.key}`,
          },
          generatedReason: input.reason || product.primaryIssue || null,
          editableFields: [textareaField("value", input.label || allowed.label || "Metafield value", input.value, 8000)],
          allowedFields: ["value"],
          expiresAt: getProposalExpiry(),
        });
      },
      async save(_context, proposal, editable) {
        const fields = metafieldEditableSchema.parse(editable);
        return savedDraftResult(proposal, {
          ...(asRecord(proposal.proposedValue)),
          ...fields,
        }, "Metafield draft saved in ProductPulse.");
      },
    },
    {
      mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createRecommendedAction,
      category: "recommendation",
      targetType: "product",
      description: "Create an app-owned ProductPulse recommendation/action record for one stored product.",
      inputSchema: createRecommendedActionSchema,
      editableDraftSchema: recommendationEditableSchema,
      requiredPermission: "merchant",
      confirmationLevel: "medium",
      sideEffectLevel: "medium",
      reversible: true,
      allowedFields: ["title", "description", "priority", "status"],
      blockedFields: blockedShopifyFields(),
      async buildProposal(context, input: CreateRecommendedActionInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const proposedValue = {
          title: input.title,
          description: input.description,
          priority: input.priority || "medium",
          status: input.status || "draft",
        };
        return baseDraftProposal({
          mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createRecommendedAction,
          product,
          input: normalizeProductInput(input, product.productGid, proposedValue),
          draftType: "recommendation_text",
          title: "Create recommended action",
          summary: `Create an app-owned ProductPulse recommendation for ${product.title}.`,
          proposedValue,
          generatedReason: input.reason || product.primaryIssue || null,
          editableFields: [
            textField("title", "Action title", proposedValue.title, 180),
            textareaField("description", "Action detail", proposedValue.description, 800),
            selectField("priority", "Priority", proposedValue.priority, ["low", "medium", "high"]),
            selectField("status", "Status", proposedValue.status, ["draft", "active", "reviewed"]),
          ],
          allowedFields: ["title", "description", "priority", "status"],
          expiresAt: getProposalExpiry(),
          sideEffectLevel: "medium",
        });
      },
      async save(context, proposal, editable) {
        const fields = recommendationEditableSchema.parse(editable);
        const product = await requireProduct(context, productRepository, proposal.targetId);
        const latestDiagnosis = await getLatestDiagnosis(db, context.shop, product.productGid);
        const action = await db.productAction.create({
          data: {
            shop: context.shop,
            diagnosisId: latestDiagnosis?.id || null,
            productGid: product.productGid,
            actionType: `ai-recommendation-${proposal.id}`,
            label: String(fields.title || proposal.title),
            status: fields.status || "draft",
            payload: {
              source: "ai_app_only_draft",
              proposalId: proposal.id,
              description: fields.description,
              priority: fields.priority || "medium",
              reason: proposal.generatedReason,
              shopifyMutationBlocked: true,
            },
            appliedAt: null,
          },
        });
        return {
          mutationName: proposal.mutationName,
          status: "success",
          summary: `Recommended action saved for ${product.title}.`,
          safeMessage: `Recommended action saved for ${product.title}. Shopify was not modified.`,
          affectedEntities: [
            productEntity(product),
            { type: "product_action", id: action.id, label: action.label },
          ],
          savedRecordId: action.id,
          savedData: {
            status: action.status,
            label: action.label,
          },
        };
      },
    },
    {
      mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.markRecommendedActionStatus,
      category: "action_status",
      targetType: "product_action",
      description: "Mark an app-owned ProductPulse recommendation/action status. This does not update Shopify.",
      inputSchema: markRecommendedActionStatusSchema,
      editableDraftSchema: recommendationStatusEditableSchema,
      requiredPermission: "merchant",
      confirmationLevel: "medium",
      sideEffectLevel: "medium",
      reversible: true,
      allowedFields: ["status", "reason"],
      blockedFields: blockedShopifyFields(),
      async buildProposal(context, input: MarkRecommendedActionStatusInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const recommendation = findRecommendation(product, input.actionId);
        if (!recommendation) throw new Error("Recommended action was not found for this product.");
        const proposedValue = { status: input.status, reason: input.reason || "" };
        return baseDraftProposal({
          mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.markRecommendedActionStatus,
          product,
          input: normalizeProductInput(input, product.productGid, proposedValue),
          draftType: "recommendation_text",
          targetType: "product_action",
          targetId: `${product.productGid}:${input.actionId}`,
          targetLabel: recommendation.label,
          category: "action_status",
          title: `Mark recommendation as ${input.status}`,
          summary: `Mark "${recommendation.label}" as ${input.status} inside ProductPulse.`,
          proposedValue,
          generatedReason: input.reason || recommendationIssue(recommendation) || product.primaryIssue || null,
          editableFields: [
            selectField("status", "Status", input.status, ["active", "reviewed", "dismissed", "completed"]),
            textareaField("reason", "Reason", input.reason || "", 700, false),
          ],
          allowedFields: ["status", "reason"],
          expiresAt: getProposalExpiry(),
          sideEffectLevel: "medium",
        });
      },
      async save(context, proposal, editable) {
        const fields = recommendationStatusEditableSchema.parse(editable);
        const originalInput = markRecommendedActionStatusSchema.parse(proposal.proposedInput || {});
        const product = await requireProduct(context, productRepository, getProductReference(originalInput));
        const recommendation = findRecommendation(product, originalInput.actionId);
        if (!recommendation) throw new Error("Recommended action was not found for this product.");
        const latestDiagnosis = await getLatestDiagnosis(db, context.shop, product.productGid);
        const status = fields.status === "completed" ? "reviewed" : fields.status;
        const action = await db.productAction.create({
          data: {
            shop: context.shop,
            diagnosisId: latestDiagnosis?.id || null,
            productGid: product.productGid,
            actionType: recommendation.id || originalInput.actionId,
            label: recommendation.label,
            status,
            payload: {
              source: "ai_app_only_status",
              proposalId: proposal.id,
              sourceActionId: originalInput.actionId,
              requestedStatus: fields.status,
              reason: fields.reason || proposal.generatedReason,
              shopifyMutationBlocked: true,
            },
            appliedAt: null,
          },
        });
        return {
          mutationName: proposal.mutationName,
          status: "success",
          summary: `Recommendation marked as ${fields.status} for ${product.title}.`,
          safeMessage: `Recommendation marked as ${fields.status} in ProductPulse. Shopify was not modified.`,
          affectedEntities: [
            productEntity(product),
            { type: "product_action", id: action.id, label: action.label },
          ],
          savedRecordId: action.id,
          savedData: {
            status: action.status,
            requestedStatus: fields.status,
          },
        };
      },
    },
  ] as AnyAiAppMutationDefinition[];
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
  if (!product) throw new Error("ProductPulse does not have a stored product record for that product.");
  return product;
}

function baseDraftProposal(input: {
  mutationName: string;
  product: AiProductRiskDetail;
  input: unknown;
  draftType: "product_description" | "seo" | "metafield_value" | "recommendation_text";
  title: string;
  summary: string;
  proposedValue: unknown;
  generatedReason?: string | null;
  editableFields: AiAppMutationEditableField[];
  allowedFields: string[];
  expiresAt: Date;
  targetType?: string;
  targetId?: string;
  targetLabel?: string | null;
  category?: "draft" | "recommendation" | "action_status";
  sideEffectLevel?: "low" | "medium";
}) {
  return {
    mutationName: input.mutationName,
    category: input.category || (input.draftType === "recommendation_text" ? "recommendation" as const : "draft" as const),
    targetType: input.targetType || "product",
    targetId: input.targetId || input.product.productGid,
    targetLabel: input.targetLabel || input.product.title,
    draftType: input.draftType,
    sourceContext: {
      productGid: input.product.productGid,
      handle: input.product.handle,
      primaryIssue: input.product.primaryIssue,
      riskScore: input.product.riskScore,
    },
    currentAppValueSnapshot: {
      latestActionCount: input.product.actionHistory.length,
      latestDiagnosisId: input.product.latestDiagnosisId,
    },
    proposedValue: input.proposedValue,
    generatedReason: input.generatedReason || null,
    evidenceReferences: input.product.diagnosis?.evidence?.slice(0, 3).map((item) => ({
      id: item.id,
      source: item.source,
    })) || [],
    validationWarnings: ["This saves app-owned data only. Shopify product data is not modified."],
    title: input.title,
    summary: input.summary,
    editableFields: input.editableFields,
    proposedInput: input.input,
    confirmationLevel: "medium" as const,
    sideEffectLevel: input.sideEffectLevel || "low" as const,
    reversible: true,
    allowedFields: input.allowedFields,
    blockedFields: blockedShopifyFields(),
    expiresAt: input.expiresAt,
  };
}

function requireProductReference(input: Record<string, unknown>, ctx: z.RefinementCtx) {
  if (getProductReference(input)) return;
  ctx.addIssue({
    code: "custom",
    path: ["productRef"],
    message: "Provide productRef, productGid, or handle.",
  });
}

function requireDraftText(input: Record<string, unknown>, ctx: z.RefinementCtx) {
  if (getDraftText(input)) return;
  ctx.addIssue({
    code: "custom",
    path: ["text"],
    message: "Provide text, draftText, or proposedText.",
  });
}

function getProductReference(input: Record<string, unknown>): string {
  return String(input.productRef || input.productGid || input.handle || "").trim();
}

function getDraftText(input: Record<string, unknown>): string {
  return String(input.text || input.draftText || input.proposedText || "").trim();
}

function normalizeProductInput<T extends Record<string, unknown>>(
  input: T,
  productGid: string,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    productRef: productGid,
    ...extra,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.sourceRecommendationId ? { sourceRecommendationId: input.sourceRecommendationId } : {}),
  };
}

function textareaField(
  name: string,
  label: string,
  value: string,
  maxLength: number,
  required = true,
): AiAppMutationEditableField {
  return { name, label, value, fieldType: "textarea", required, maxLength };
}

function textField(
  name: string,
  label: string,
  value: string,
  maxLength: number,
  required = true,
): AiAppMutationEditableField {
  return { name, label, value, fieldType: "text", required, maxLength };
}

function selectField(
  name: string,
  label: string,
  value: string,
  options: string[],
): AiAppMutationEditableField {
  return {
    name,
    label,
    value,
    fieldType: "select",
    required: true,
    options: options.map((option) => ({ label: capitalize(option), value: option })),
  };
}

function blockedShopifyFields(): string[] {
  return [
    "shop",
    "shopId",
    "storeId",
    "merchantId",
    "userId",
    "applyMode",
    "shopifyMutation",
    "adminGraphql",
    "productUpdate",
    "metafieldsSet",
  ];
}

function savedDraftResult(
  proposal: AiAppMutationProposal,
  savedData: unknown,
  message: string,
): AiAppMutationSaveResult {
  return {
    mutationName: proposal.mutationName,
    status: "success",
    summary: `${message} Shopify was not modified.`,
    safeMessage: `${message} Shopify was not modified.`,
    affectedEntities: [{ type: proposal.targetType, id: proposal.targetId, label: proposal.targetLabel }],
    savedRecordId: proposal.id,
    savedData,
  };
}

function productEntity(product: AiProductRiskDetail) {
  return {
    type: "product",
    id: product.productGid,
    label: product.title,
  };
}

function findRecommendation(product: AiProductRiskDetail, actionId: string) {
  const recommendations = product.diagnosis?.recommendations || [];
  return recommendations.find((recommendation) => recommendation.id === actionId)
    || product.actionHistory.find((action) => action.id === actionId || action.actionType === actionId)
    || null;
}

function recommendationIssue(
  recommendation: NonNullable<ReturnType<typeof findRecommendation>>,
): string | null {
  return "issue" in recommendation ? recommendation.issue : null;
}

async function getLatestDiagnosis(db: ProductPulseAppMutationDbClient, shop: string, productGid: string) {
  return db.productDiagnosis.findFirst({
    where: { shop, productGid, status: "Completed" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true },
  });
}

function getAllowedMetafieldDrafts(env: NodeJS.ProcessEnv): Array<{
  namespace: string;
  key: string;
  type: string;
  label?: string;
}> {
  const configured = parseConfiguredMetafields(env.AI_ALLOWED_METAFIELD_DRAFTS);
  return configured.length ? configured : [{
    namespace: "productpulse",
    key: "faq_html",
    type: "multi_line_text_field",
    label: "ProductPulse FAQ HTML",
  }];
}

function parseConfiguredMetafields(value: unknown): Array<{ namespace: string; key: string; type: string; label?: string }> {
  const raw = String(value || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => asRecord(item))
      .filter(Boolean)
      .map((item) => ({
        namespace: String(item.namespace || "").trim(),
        key: String(item.key || "").trim(),
        type: String(item.type || "").trim(),
        label: String(item.label || "").trim() || undefined,
      }))
      .filter((item) => item.namespace && item.key && item.type);
  } catch {
    return [];
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getProposalExpiry(): Date {
  return new Date(Date.now() + 30 * 60 * 1000);
}

function capitalize(value: string): string {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}

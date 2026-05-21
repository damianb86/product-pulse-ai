import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
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
  updateRecommendedActionDraft: "product_pulse_update_recommended_action_draft",
  createProductAction: "product_pulse_create_product_action",
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

const looseAppValueSchema = z.union([
  z.string().trim().min(1).max(8000),
  z.record(z.string(), z.unknown()),
]);

const appActionStatusSchema = z.enum(["draft", "active", "reviewed", "dismissed", "completed"]);
const editableActionStatusSchema = z.enum(["draft", "active", "reviewed", "dismissed"]);
const actionPrioritySchema = z.enum(["low", "medium", "high"]);
const descriptionOperationSchema = z.enum(["prepend", "append", "replace"]);

const compactStringRecordSchema = z.record(
  z.string(),
  z.union([
    z.string().trim().max(1200),
    z.number(),
    z.boolean(),
    z.null(),
  ]),
);

const actionPayloadDraftFields = {
  actionId: z.string().trim().min(1).max(180).optional(),
  sourceRecommendationId: z.string().trim().max(180).optional(),
  sourceActionId: z.string().trim().max(180).optional(),
  actionType: z.string().trim().max(180).optional(),
  type: z.string().trim().max(180).optional(),
  draftType: z.string().trim().max(120).optional(),
  label: z.string().trim().min(3).max(180).optional(),
  title: z.string().trim().min(3).max(180).optional(),
  actionTitle: z.string().trim().min(3).max(180).optional(),
  description: z.string().trim().min(1).max(3000).optional(),
  text: z.string().trim().min(1).max(5000).optional(),
  draftText: z.string().trim().min(1).max(5000).optional(),
  proposedText: z.string().trim().min(1).max(5000).optional(),
  proposedValue: looseAppValueSchema.optional(),
  value: looseAppValueSchema.optional(),
  note: z.string().trim().min(1).max(5000).optional(),
  field: z.string().trim().max(180).optional(),
  targetField: z.string().trim().max(180).optional(),
  target: z.string().trim().max(180).optional(),
  shopifyField: z.string().trim().max(180).optional(),
  descriptionOperation: descriptionOperationSchema.optional(),
  insertionPosition: descriptionOperationSchema.optional(),
  actionVariant: z.string().trim().max(180).optional(),
  metafieldNamespace: z.string().trim().max(120).optional(),
  metafieldKey: z.string().trim().max(120).optional(),
  metafieldType: z.string().trim().max(120).optional(),
  mediaUpdates: z.array(compactStringRecordSchema).max(20).optional(),
  descriptionChanges: z.array(compactStringRecordSchema).max(20).optional(),
  faqItems: z.array(compactStringRecordSchema).max(20).optional(),
  tags: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  priority: actionPrioritySchema.optional(),
  status: appActionStatusSchema.optional(),
  reason: z.string().trim().max(1000).optional(),
  expectedResult: z.string().trim().max(1000).optional(),
};

const productDescriptionDraftSchema = z.object({
  ...productReferenceFields,
  draftType: z.string().trim().max(120).optional(),
  title: z.string().trim().max(180).optional(),
  text: z.string().trim().min(1).max(5000).optional(),
  draftText: z.string().trim().min(1).max(5000).optional(),
  proposedText: z.string().trim().min(1).max(5000).optional(),
  proposedValue: looseAppValueSchema.optional(),
  value: looseAppValueSchema.optional(),
  actionId: z.string().trim().max(180).optional(),
  sourceRecommendationId: z.string().trim().max(180).optional(),
  field: z.string().trim().max(180).optional(),
  targetField: z.string().trim().max(180).optional(),
  descriptionOperation: descriptionOperationSchema.optional(),
  reason: z.string().trim().max(700).optional(),
}).strict().superRefine(requireProductReference).superRefine(requireDraftText);

const seoDraftSchema = z.object({
  ...productReferenceFields,
  draftType: z.string().trim().max(120).optional(),
  title: z.string().trim().max(180).optional(),
  seoTitle: z.string().trim().min(1).max(90).optional(),
  seoDescription: z.string().trim().min(1).max(220).optional(),
  text: z.string().trim().min(1).max(220).optional(),
  proposedText: z.string().trim().min(1).max(220).optional(),
  proposedValue: looseAppValueSchema.optional(),
  value: looseAppValueSchema.optional(),
  field: z.string().trim().max(180).optional(),
  targetField: z.string().trim().max(180).optional(),
  reason: z.string().trim().max(700).optional(),
  sourceRecommendationId: z.string().trim().max(160).optional(),
}).strict().superRefine(requireProductReference).superRefine((input, ctx) => {
  const fields = getSeoDraftFields(input);
  if (fields.seoTitle || fields.seoDescription) return;
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
  ...actionPayloadDraftFields,
}).strict().superRefine(requireProductReference).superRefine(requireActionTitleOrText);

const updateRecommendedActionDraftSchema = z.object({
  ...productReferenceFields,
  ...actionPayloadDraftFields,
}).strict().superRefine(requireProductReference).superRefine(requireActionPatch);

const createProductActionSchema = z.object({
  ...productReferenceFields,
  ...actionPayloadDraftFields,
}).strict().superRefine(requireProductReference).superRefine(requireActionTitleOrText);

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
  description: z.string().trim().min(0).max(3000).optional(),
  draftText: z.string().trim().max(5000).optional(),
  field: z.string().trim().max(180).optional(),
  descriptionOperation: descriptionOperationSchema.optional(),
  priority: actionPrioritySchema.optional(),
  status: editableActionStatusSchema.optional(),
}).strict();

const recommendationStatusEditableSchema = z.object({
  status: z.enum(["active", "reviewed", "dismissed", "completed"]),
  reason: z.string().trim().max(700).optional(),
}).strict();

type ProductDescriptionDraftInput = z.infer<typeof productDescriptionDraftSchema>;
type SeoDraftInput = z.infer<typeof seoDraftSchema>;
type MetafieldDraftInput = z.infer<typeof metafieldDraftSchema>;
type CreateRecommendedActionInput = z.infer<typeof createRecommendedActionSchema>;
type UpdateRecommendedActionDraftInput = z.infer<typeof updateRecommendedActionDraftSchema>;
type CreateProductActionInput = z.infer<typeof createProductActionSchema>;
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
        const field = getTargetField(input);
        return baseDraftProposal({
          mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductDescriptionDraft,
          product,
          input: normalizeProductInput(input, product.productGid, {
            text,
            ...(field ? { field } : {}),
          }),
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
        const proposedValue = getSeoDraftFields(input);
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
      allowedFields: ["title", "description", "draftText", "field", "descriptionOperation", "priority", "status"],
      blockedFields: blockedShopifyFields(),
      async buildProposal(context, input: CreateRecommendedActionInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const proposedValue = buildActionProposedValue(input, product);
        return baseDraftProposal({
          mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createRecommendedAction,
          product,
          input: normalizeActionMutationInput(input, product.productGid, proposedValue),
          draftType: "recommendation_text",
          title: proposedValue.title,
          summary: `Create an app-owned ProductPulse recommendation for ${product.title}.`,
          proposedValue,
          generatedReason: input.reason || product.primaryIssue || null,
          editableFields: [
            textField("title", "Action title", proposedValue.title, 180),
            textareaField("description", "Action detail", proposedValue.description, 3000, false),
            textareaField("draftText", "Generated action text", proposedValue.draftText, 5000, false),
            textField("field", "Target field", proposedValue.field, 180, false),
            selectField("descriptionOperation", "Description operation", proposedValue.descriptionOperation, ["prepend", "append", "replace"], false),
            selectField("priority", "Priority", proposedValue.priority, ["low", "medium", "high"]),
            selectField("status", "Status", proposedValue.status, ["draft", "active", "reviewed", "dismissed"]),
          ],
          allowedFields: ["title", "description", "draftText", "field", "descriptionOperation", "priority", "status"],
          expiresAt: getProposalExpiry(),
          sideEffectLevel: "medium",
        });
      },
      async save(context, proposal, editable) {
        const fields = recommendationEditableSchema.parse(editable);
        const originalInput = createRecommendedActionSchema.parse(proposal.proposedInput || {});
        return saveCreatedProductAction({
          context,
          productRepository,
          db,
          proposal,
          originalInput,
          fields,
          source: "ai_app_only_action_create",
        });
      },
    },
    {
      mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.updateRecommendedActionDraft,
      category: "recommendation",
      targetType: "product_action",
      description: "Rewrite or update an existing ProductPulse recommendation/action draft for a stored product. This does not update Shopify.",
      inputSchema: updateRecommendedActionDraftSchema,
      editableDraftSchema: recommendationEditableSchema,
      requiredPermission: "merchant",
      confirmationLevel: "medium",
      sideEffectLevel: "medium",
      reversible: true,
      allowedFields: ["title", "description", "draftText", "field", "descriptionOperation", "priority", "status"],
      blockedFields: blockedShopifyFields(),
      async buildProposal(context, input: UpdateRecommendedActionDraftInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const recommendation = findRecommendationForInput(product, input);
        if (!recommendation) throw new Error("Recommended action was not found for this product.");
        const actionId = getRecommendationId(recommendation);
        const proposedValue = buildActionProposedValue(input, product, recommendation);
        return baseDraftProposal({
          mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.updateRecommendedActionDraft,
          product,
          input: normalizeActionMutationInput({ ...input, actionId }, product.productGid, proposedValue),
          draftType: "recommendation_text",
          targetType: "product_action",
          targetId: `${product.productGid}:${actionId}`,
          targetLabel: recommendation.label,
          category: "recommendation",
          title: `Update ${recommendation.label}`,
          summary: `Save an AI-regenerated version of "${recommendation.label}" inside ProductPulse.`,
          proposedValue,
          generatedReason: input.reason || recommendationIssue(recommendation) || product.primaryIssue || null,
          editableFields: [
            textField("title", "Action title", proposedValue.title, 180),
            textareaField("description", "Action detail", proposedValue.description, 3000, false),
            textareaField("draftText", "Regenerated action text", proposedValue.draftText, 5000, false),
            textField("field", "Target field", proposedValue.field, 180, false),
            selectField("descriptionOperation", "Description operation", proposedValue.descriptionOperation, ["prepend", "append", "replace"], false),
            selectField("priority", "Priority", proposedValue.priority, ["low", "medium", "high"]),
            selectField("status", "Status", proposedValue.status, ["draft", "active", "reviewed", "dismissed"]),
          ],
          allowedFields: ["title", "description", "draftText", "field", "descriptionOperation", "priority", "status"],
          expiresAt: getProposalExpiry(),
          sideEffectLevel: "medium",
        });
      },
      async save(context, proposal, editable) {
        const fields = recommendationEditableSchema.parse(editable);
        const originalInput = updateRecommendedActionDraftSchema.parse(proposal.proposedInput || {});
        const product = await requireProduct(context, productRepository, getProductReference(originalInput));
        const recommendation = findRecommendationForInput(product, originalInput);
        if (!recommendation) throw new Error("Recommended action was not found for this product.");
        const actionId = getRecommendationId(recommendation);
        const latestDiagnosis = await updateLatestDiagnosisRecommendation(db, context.shop, product.productGid, actionId, {
          ...originalInput,
          actionId,
          ...fields,
          title: fields.title,
          description: fields.description,
          draftText: fields.draftText,
          field: fields.field,
          status: fields.status || "draft",
          reason: originalInput.reason || proposal.generatedReason || "",
        });
        const payload = buildProductActionPayload({
          proposal,
          input: originalInput,
          fields,
          product,
          source: "ai_app_only_action_update",
          sourceActionId: actionId,
        });
        const action = await db.productAction.create({
          data: {
            shop: context.shop,
            diagnosisId: latestDiagnosis?.id || null,
            productGid: product.productGid,
            actionType: actionId,
            label: String(fields.title || recommendation.label),
            status: normalizeSavedActionStatus(fields.status || "draft"),
            payload: payload as unknown as Prisma.InputJsonValue,
            appliedAt: null,
          },
        });
        return {
          mutationName: proposal.mutationName,
          status: "success",
          summary: `Recommended action updated for ${product.title}.`,
          safeMessage: `Recommended action updated in ProductPulse for ${product.title}. Shopify was not modified.`,
          affectedEntities: [
            productEntity(product),
            { type: "product_action", id: action.id, label: action.label },
          ],
          savedRecordId: action.id,
          savedData: {
            status: action.status,
            label: action.label,
            sourceActionId: actionId,
            aiRegeneratedBy: "ProductPulse AI chat",
          },
        };
      },
    },
    {
      mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductAction,
      category: "recommendation",
      targetType: "product",
      description: "Create a new app-owned ProductPulse action for a stored product. This does not update Shopify.",
      inputSchema: createProductActionSchema,
      editableDraftSchema: recommendationEditableSchema,
      requiredPermission: "merchant",
      confirmationLevel: "medium",
      sideEffectLevel: "medium",
      reversible: true,
      allowedFields: ["title", "description", "draftText", "field", "descriptionOperation", "priority", "status"],
      blockedFields: blockedShopifyFields(),
      async buildProposal(context, input: CreateProductActionInput) {
        const product = await requireProduct(context, productRepository, getProductReference(input));
        const proposedValue = buildActionProposedValue(input, product);
        return baseDraftProposal({
          mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductAction,
          product,
          input: normalizeActionMutationInput(input, product.productGid, proposedValue),
          draftType: "recommendation_text",
          title: proposedValue.title,
          summary: `Create a new ProductPulse action for ${product.title}.`,
          proposedValue,
          generatedReason: input.reason || product.primaryIssue || null,
          editableFields: [
            textField("title", "Action title", proposedValue.title, 180),
            textareaField("description", "Action detail", proposedValue.description, 3000, false),
            textareaField("draftText", "Action draft text", proposedValue.draftText, 5000, false),
            textField("field", "Target field", proposedValue.field, 180, false),
            selectField("descriptionOperation", "Description operation", proposedValue.descriptionOperation, ["prepend", "append", "replace"], false),
            selectField("priority", "Priority", proposedValue.priority, ["low", "medium", "high"]),
            selectField("status", "Status", proposedValue.status, ["draft", "active", "reviewed", "dismissed"]),
          ],
          allowedFields: ["title", "description", "draftText", "field", "descriptionOperation", "priority", "status"],
          expiresAt: getProposalExpiry(),
          sideEffectLevel: "medium",
        });
      },
      async save(context, proposal, editable) {
        const fields = recommendationEditableSchema.parse(editable);
        const originalInput = createProductActionSchema.parse(proposal.proposedInput || {});
        return saveCreatedProductAction({
          context,
          productRepository,
          db,
          proposal,
          originalInput,
          fields,
          source: "ai_app_only_action_create",
        });
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

function requireActionTitleOrText(input: Record<string, unknown>, ctx: z.RefinementCtx) {
  if (getActionTitle(input) || getDraftText(input) || String(input.description || input.note || "").trim()) return;
  ctx.addIssue({
    code: "custom",
    path: ["title"],
    message: "Provide title, label, description, text, draftText, proposedText, or note.",
  });
}

function requireActionPatch(input: Record<string, unknown>, ctx: z.RefinementCtx) {
  const hasPatch = [
    "title",
    "label",
    "description",
    "text",
    "draftText",
    "proposedText",
    "note",
    "field",
    "shopifyField",
    "descriptionOperation",
    "insertionPosition",
    "metafieldNamespace",
    "metafieldKey",
    "metafieldType",
    "mediaUpdates",
    "descriptionChanges",
    "faqItems",
    "tags",
    "priority",
    "status",
    "reason",
    "proposedValue",
    "value",
  ].some((field) => {
    const value = input[field];
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return Boolean(String(value || "").trim());
  });
  if (hasPatch) return;
  ctx.addIssue({
    code: "custom",
    path: ["draftText"],
    message: "Provide at least one editable action field.",
  });
}

function getProductReference(input: Record<string, unknown>): string {
  return String(input.productRef || input.productGid || input.handle || "").trim();
}

function getDraftText(input: Record<string, unknown>): string {
  const proposedValue = asRecord(input.proposedValue);
  const value = asRecord(input.value);
  return String(
    input.text
      || input.draftText
      || input.proposedText
      || input.note
      || input.description
      || (typeof input.proposedValue === "string" ? input.proposedValue : "")
      || proposedValue.text
      || proposedValue.draftText
      || proposedValue.proposedText
      || proposedValue.description
      || proposedValue.value
      || (typeof input.value === "string" ? input.value : "")
      || value.text
      || value.draftText
      || value.proposedText
      || value.description
      || value.value
      || "",
  ).trim();
}

function getActionTitle(input: Record<string, unknown>): string {
  const proposedValue = asRecord(input.proposedValue);
  return String(input.title || input.label || input.actionTitle || proposedValue.title || proposedValue.label || "").trim();
}

function getTargetField(input: Record<string, unknown>): string {
  const proposedValue = asRecord(input.proposedValue);
  return String(
    input.field
      || input.targetField
      || input.target
      || input.shopifyField
      || proposedValue.field
      || proposedValue.targetField
      || proposedValue.target
      || proposedValue.shopifyField
      || "",
  ).trim();
}

function getSeoDraftFields(input: Record<string, unknown>): { seoTitle: string; seoDescription: string } {
  const proposedValue = asRecord(input.proposedValue);
  const value = asRecord(input.value);
  const targetField = getTargetField(input).toLowerCase();
  const draftType = String(input.draftType || proposedValue.draftType || "").toLowerCase();
  const genericText = getDraftText(input);
  const titleCandidate = String(input.seoTitle || proposedValue.seoTitle || proposedValue.title || value.seoTitle || "").trim();
  const descriptionCandidate = String(input.seoDescription || proposedValue.seoDescription || proposedValue.metaDescription || value.seoDescription || "").trim();
  const genericIsTitle = targetField.includes("title") || draftType.includes("title");
  const genericIsDescription = targetField.includes("description") || targetField.includes("meta") || draftType.includes("description") || draftType.includes("meta");
  return {
    seoTitle: titleCandidate || (genericIsTitle ? genericText.slice(0, 90) : ""),
    seoDescription: descriptionCandidate || (genericIsDescription || !genericIsTitle ? genericText.slice(0, 220) : ""),
  };
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

function normalizeActionMutationInput<T extends Record<string, unknown>>(
  input: T,
  productGid: string,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    productRef: productGid,
    ...copyDefinedActionInput(input),
    ...extra,
  };
}

function buildActionProposedValue(
  input: Record<string, unknown>,
  product: AiProductRiskDetail,
  existingAction?: NonNullable<ReturnType<typeof findRecommendation>>,
): {
  title: string;
  description: string;
  draftText: string;
  field: string;
  descriptionOperation: "prepend" | "append" | "replace";
  priority: "low" | "medium" | "high";
  status: "draft" | "active" | "reviewed" | "dismissed";
} {
  const existingPayload = "payloadSummary" in (existingAction || {}) ? asRecord(existingAction?.payloadSummary) : {};
  const title = getActionTitle(input)
    || String(existingAction?.label || "").trim()
    || inferActionTitle(input, product);
  const draftText = getDraftText(input)
    || String(existingAction && "draftPreview" in existingAction ? existingAction.draftPreview || "" : "").trim()
    || String(input.description || "").trim();
  const description = String(input.description || existingPayload.description || input.reason || "").trim()
    || (draftText ? "AI-regenerated app-owned action text." : `App-owned action for ${product.title}.`);
  const field = getTargetField(input) || String(existingPayload.field || "").trim();
  const descriptionOperation = normalizeDescriptionOperation(input.descriptionOperation || input.insertionPosition || existingPayload.descriptionOperation);
  const priority = normalizePriority(input.priority || existingPayload.priority);
  const status = normalizeEditableStatus(input.status || existingAction?.status || "draft");

  return {
    title,
    description,
    draftText,
    field,
    descriptionOperation,
    priority,
    status,
  };
}

async function saveCreatedProductAction(input: {
  context: AiToolContext;
  productRepository: ProductPulseAiRepository;
  db: ProductPulseAppMutationDbClient;
  proposal: AiAppMutationProposal;
  originalInput: CreateRecommendedActionInput | CreateProductActionInput;
  fields: z.infer<typeof recommendationEditableSchema>;
  source: "ai_app_only_action_create";
}): Promise<AiAppMutationSaveResult> {
  const product = await requireProduct(input.context, input.productRepository, getProductReference(input.originalInput));
  const latestDiagnosis = await appendLatestDiagnosisRecommendation(input.db, input.context.shop, product.productGid, {
    ...input.originalInput,
    ...input.fields,
    actionId: String(input.originalInput.actionId || `ai-action-${input.proposal.id}`),
    title: input.fields.title,
    description: input.fields.description,
    draftText: input.fields.draftText,
    field: input.fields.field,
    status: input.fields.status || "draft",
    reason: input.originalInput.reason || input.proposal.generatedReason || "",
  });
  const actionType = String(input.originalInput.actionId || `ai-action-${input.proposal.id}`);
  const payload = buildProductActionPayload({
    proposal: input.proposal,
    input: input.originalInput,
    fields: input.fields,
    product,
    source: input.source,
    sourceActionId: actionType,
  });
  const action = await input.db.productAction.create({
    data: {
      shop: input.context.shop,
      diagnosisId: latestDiagnosis?.id || null,
      productGid: product.productGid,
      actionType,
      label: String(input.fields.title || input.proposal.title),
      status: normalizeSavedActionStatus(input.fields.status || "draft"),
      payload: payload as unknown as Prisma.InputJsonValue,
      appliedAt: null,
    },
  });
  return {
    mutationName: input.proposal.mutationName,
    status: "success",
    summary: `ProductPulse action saved for ${product.title}.`,
    safeMessage: `ProductPulse action saved for ${product.title}. Shopify was not modified.`,
    affectedEntities: [
      productEntity(product),
      { type: "product_action", id: action.id, label: action.label },
    ],
    savedRecordId: action.id,
    savedData: {
      status: action.status,
      label: action.label,
      aiGeneratedBy: "ProductPulse AI chat",
    },
  };
}

function buildProductActionPayload(input: {
  proposal: AiAppMutationProposal;
  input: Record<string, unknown>;
  fields: z.infer<typeof recommendationEditableSchema>;
  product: AiProductRiskDetail;
  source: string;
  sourceActionId: string;
}): Record<string, unknown> {
  const draftText = String(input.fields.draftText || getDraftText(input.input) || "").trim();
  const descriptionOperation = normalizeDescriptionOperation(input.fields.descriptionOperation || input.input.descriptionOperation || input.input.insertionPosition);
  return stripEmptyObject({
    ...copyDefinedActionInput(input.input),
    source: input.source,
    proposalId: input.proposal.id,
    sourceActionId: input.sourceActionId,
    canonicalActionId: input.sourceActionId,
    actionAliases: [
      input.sourceActionId,
      input.input.actionId,
      input.input.sourceRecommendationId,
      input.input.sourceActionId,
    ].map((item) => String(item || "").trim()).filter(Boolean),
    description: input.fields.description || input.input.description || "",
    draftText,
    note: draftText,
    field: input.fields.field || input.input.field || input.input.shopifyField || "",
    descriptionOperation,
    insertionPosition: descriptionOperation,
    priority: input.fields.priority || input.input.priority || "medium",
    reason: input.input.reason || input.proposal.generatedReason || input.product.primaryIssue || "",
    aiGeneratedBy: "ProductPulse AI chat",
    aiRegeneratedBy: input.source.includes("update") ? "ProductPulse AI chat" : undefined,
    aiRegeneratedAt: input.source.includes("update") ? new Date().toISOString() : undefined,
    aiCreatedAt: input.source.includes("create") ? new Date().toISOString() : undefined,
    shopifyMutationBlocked: true,
  });
}

async function appendLatestDiagnosisRecommendation(
  db: ProductPulseAppMutationDbClient,
  shop: string,
  productGid: string,
  input: Record<string, unknown>,
) {
  const latestDiagnosis = await getLatestDiagnosis(db, shop, productGid);
  if (!latestDiagnosis?.id) return latestDiagnosis;
  const recommendations = Array.isArray(latestDiagnosis.recommendations) ? latestDiagnosis.recommendations : [];
  const actionId = String(input.actionId || "").trim();
  const nextRecommendation = buildStoredRecommendation(input, { created: true });
  const exists = recommendations.some((recommendation) => recommendationIdMatches(recommendation, actionId));
  const nextRecommendations = exists
    ? recommendations.map((recommendation) => (
      recommendationIdMatches(recommendation, actionId)
        ? mergeStoredRecommendation(recommendation, input, { created: false })
        : recommendation
    ))
    : [...recommendations, nextRecommendation];
  await db.productDiagnosis.update({
    where: { id: latestDiagnosis.id },
    data: { recommendations: nextRecommendations as unknown as Prisma.InputJsonValue },
  });
  return latestDiagnosis;
}

async function updateLatestDiagnosisRecommendation(
  db: ProductPulseAppMutationDbClient,
  shop: string,
  productGid: string,
  actionId: string,
  input: Record<string, unknown>,
) {
  const latestDiagnosis = await getLatestDiagnosis(db, shop, productGid);
  if (!latestDiagnosis?.id) return latestDiagnosis;
  const recommendations = Array.isArray(latestDiagnosis.recommendations) ? latestDiagnosis.recommendations : [];
  const nextRecommendations = recommendations.map((recommendation) => (
    recommendationIdMatches(recommendation, actionId)
      ? mergeStoredRecommendation(recommendation, input, { created: false })
      : recommendation
  ));
  await db.productDiagnosis.update({
    where: { id: latestDiagnosis.id },
    data: { recommendations: nextRecommendations as unknown as Prisma.InputJsonValue },
  });
  return latestDiagnosis;
}

function buildStoredRecommendation(input: Record<string, unknown>, options: { created: boolean }): Record<string, unknown> {
  const actionId = String(input.actionId || input.sourceActionId || slugifyActionId(input.title || "ai-action")).trim();
  const draftText = getDraftText(input);
  const label = getActionTitle(input) || "AI-created ProductPulse action";
  const description = String(input.description || input.reason || draftText || "").trim();
  const payload = buildStoredRecommendationPayload(input, options);
  return stripEmptyObject({
    id: actionId,
    actionId,
    label,
    title: label,
    type: input.type || input.actionType || inferStoredActionType(input),
    status: input.status || "draft",
    effort: input.effort || "low",
    detail: description || draftText,
    reason: input.reason || "",
    payload,
    aiGeneratedBy: "ProductPulse AI chat",
    aiRegeneratedBy: options.created ? undefined : "ProductPulse AI chat",
    aiRegeneratedAt: options.created ? undefined : new Date().toISOString(),
    aiCreatedAt: options.created ? new Date().toISOString() : undefined,
  });
}

function mergeStoredRecommendation(
  recommendation: unknown,
  input: Record<string, unknown>,
  options: { created: boolean },
): Record<string, unknown> {
  const existing = asRecord(recommendation);
  const next = buildStoredRecommendation({
    ...existing,
    ...(asRecord(existing.payload)),
    ...input,
    actionId: input.actionId || existing.id || existing.actionId,
  }, options);
  return {
    ...existing,
    ...stripEmptyObject(next),
    payload: {
      ...asRecord(existing.payload),
      ...asRecord(next.payload),
    },
  };
}

function buildStoredRecommendationPayload(input: Record<string, unknown>, options: { created: boolean }): Record<string, unknown> {
  const draftText = getDraftText(input);
  const descriptionOperation = normalizeDescriptionOperation(input.descriptionOperation || input.insertionPosition);
  return stripEmptyObject({
    source: options.created ? "ai_app_only_action_create" : "ai_app_only_action_update",
    sourceActionId: input.actionId || input.sourceActionId,
    canonicalActionId: input.actionId || input.sourceActionId,
    actionAliases: [
      input.actionId,
      input.sourceActionId,
      input.sourceRecommendationId,
    ].map((item) => String(item || "").trim()).filter(Boolean),
    description: input.description || "",
    draftText,
    note: draftText,
    field: input.field || input.shopifyField || "",
    shopifyField: input.shopifyField || input.field || "",
    descriptionOperation,
    insertionPosition: descriptionOperation,
    actionVariant: input.actionVariant,
    metafieldNamespace: input.metafieldNamespace,
    metafieldKey: input.metafieldKey,
    metafieldType: input.metafieldType,
    mediaUpdates: input.mediaUpdates,
    descriptionChanges: input.descriptionChanges,
    faqItems: input.faqItems,
    tags: input.tags,
    priority: input.priority || "medium",
    status: input.status || "draft",
    reason: input.reason || "",
    aiGeneratedBy: "ProductPulse AI chat",
    aiRegeneratedBy: options.created ? undefined : "ProductPulse AI chat",
    aiRegeneratedAt: options.created ? undefined : new Date().toISOString(),
    aiCreatedAt: options.created ? new Date().toISOString() : undefined,
    shopifyMutationBlocked: true,
  });
}

function copyDefinedActionInput(input: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "actionId",
    "sourceRecommendationId",
    "sourceActionId",
    "actionType",
    "type",
    "draftType",
    "label",
    "title",
    "actionTitle",
    "description",
    "text",
    "draftText",
    "proposedText",
    "proposedValue",
    "value",
    "note",
    "field",
    "targetField",
    "target",
    "shopifyField",
    "descriptionOperation",
    "insertionPosition",
    "actionVariant",
    "metafieldNamespace",
    "metafieldKey",
    "metafieldType",
    "mediaUpdates",
    "descriptionChanges",
    "faqItems",
    "tags",
    "priority",
    "status",
    "reason",
    "expectedResult",
  ];
  return stripEmptyObject(Object.fromEntries(
    allowed.map((key) => [key, input[key]]),
  ));
}

function stripEmptyObject(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string" && !value.trim()) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }));
}

function recommendationIdMatches(recommendation: unknown, actionId: string): boolean {
  const record = asRecord(recommendation);
  const payload = asRecord(record.payload);
  const candidates = [
    record.id,
    record.actionId,
    record.actionType,
    record.label,
    record.title,
    payload.sourceActionId,
    payload.canonicalActionId,
    ...(Array.isArray(payload.actionAliases) ? payload.actionAliases : []),
  ];
  return candidates.some((candidate) => normalizeActionId(candidate) === normalizeActionId(actionId));
}

function inferActionTitle(input: Record<string, unknown>, product: AiProductRiskDetail): string {
  const field = String(input.field || input.shopifyField || "").toLowerCase();
  if (field.includes("seo") || field.includes("meta")) return "Update SEO recommendation";
  if (field.includes("media") || field.includes("alt")) return "Update image guidance";
  if (field.includes("description")) return "Update product description guidance";
  if (String(input.type || input.actionType || "").toLowerCase().includes("media")) return "Update image guidance";
  return `Create ProductPulse action for ${product.title}`;
}

function inferStoredActionType(input: Record<string, unknown>): string {
  const text = `${input.actionType || ""} ${input.type || ""} ${input.field || ""} ${input.shopifyField || ""}`.toLowerCase();
  if (text.includes("seo") || text.includes("meta")) return "product_metadata";
  if (text.includes("media") || text.includes("image") || text.includes("alt")) return "media_alt_text";
  if (text.includes("description")) return "product_description";
  if (text.includes("metafield")) return "product_metafield";
  return "ai_app_only_action";
}

function normalizePriority(value: unknown): "low" | "medium" | "high" {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "low" || normalized === "medium" || normalized === "high") return normalized;
  return "medium";
}

function normalizeEditableStatus(value: unknown): "draft" | "active" | "reviewed" | "dismissed" {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "active" || normalized === "reviewed" || normalized === "dismissed") return normalized;
  return "draft";
}

function normalizeSavedActionStatus(value: unknown): string {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "completed") return "reviewed";
  if (normalized === "active" || normalized === "reviewed" || normalized === "dismissed") return normalized;
  return "draft";
}

function normalizeDescriptionOperation(value: unknown): "prepend" | "append" | "replace" {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "append" || normalized === "replace") return normalized;
  return "prepend";
}

function normalizeActionId(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function slugifyActionId(value: unknown): string {
  return normalizeActionId(value) || `ai-action-${Date.now()}`;
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
  required = true,
): AiAppMutationEditableField {
  return {
    name,
    label,
    value,
    fieldType: "select",
    required,
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

function findRecommendationForInput(product: AiProductRiskDetail, input: Record<string, unknown>) {
  const explicit = String(input.actionId || input.sourceRecommendationId || input.sourceActionId || "").trim();
  if (explicit) {
    const found = findRecommendation(product, explicit);
    if (found) return found;
  }

  const titleRef = getActionTitle(input);
  if (titleRef) {
    const found = findRecommendationByText(product, titleRef);
    if (found) return found;
  }

  const field = getTargetField(input);
  if (field) {
    const found = findRecommendationByText(product, field);
    if (found) return found;
  }

  const draftType = String(input.draftType || "").trim();
  if (draftType) {
    const found = findRecommendationByText(product, draftType);
    if (found) return found;
  }

  const recommendations = product.diagnosis?.recommendations || [];
  return recommendations[0] || product.actionHistory[0] || null;
}

function findRecommendationByText(product: AiProductRiskDetail, reference: string) {
  const normalizedReference = normalizeActionId(reference);
  if (!normalizedReference) return null;
  const candidates = [
    ...(product.diagnosis?.recommendations || []),
    ...product.actionHistory,
  ];
  return candidates.find((recommendation) => {
    const text = recommendationSearchText(recommendation);
    if (text.includes(normalizedReference)) return true;
    if (normalizedReference.includes("description") || normalizedReference.includes("pdp") || normalizedReference.includes("copy")) {
      return /\b(description|pdp|copy|content|expectation|faq)\b/.test(text);
    }
    if (normalizedReference.includes("seo") || normalizedReference.includes("meta")) {
      return /\b(seo|meta|metadata|title)\b/.test(text);
    }
    if (normalizedReference.includes("media") || normalizedReference.includes("image") || normalizedReference.includes("alt")) {
      return /\b(media|image|alt)\b/.test(text);
    }
    if (normalizedReference.includes("review") || normalizedReference.includes("manual") || normalizedReference.includes("qa")) {
      return /\b(review|manual|qa|quality|supplier|evidence)\b/.test(text);
    }
    return false;
  }) || null;
}

function recommendationSearchText(recommendation: NonNullable<ReturnType<typeof findRecommendation>>): string {
  const record = recommendation as unknown as Record<string, unknown>;
  return normalizeActionId([
    record.id,
    record.actionType,
    record.label,
    record.type,
    record.status,
    "issue" in recommendation ? recommendation.issue : "",
    "draftPreview" in recommendation ? recommendation.draftPreview : "",
    JSON.stringify("payloadSummary" in recommendation ? recommendation.payloadSummary : {}),
  ].filter(Boolean).join(" "));
}

function getRecommendationId(recommendation: NonNullable<ReturnType<typeof findRecommendation>>): string {
  if ("id" in recommendation && recommendation.id) return String(recommendation.id);
  if ("actionType" in recommendation && recommendation.actionType) return String(recommendation.actionType);
  return slugifyActionId(recommendation.label || "productpulse-action");
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
    select: { id: true, recommendations: true },
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

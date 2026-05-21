import { z } from "zod";

const textBlockSchema = z.object({
  type: z.literal("summary"),
  title: z.string().max(160).optional(),
  text: z.string().max(1200),
}).strict();

const productReferenceBlockSchema = z.object({
  type: z.literal("product_reference"),
  productGid: z.string().max(320).optional(),
  title: z.string().max(220),
  handle: z.string().max(180).optional(),
  subtitle: z.string().max(260).nullable().optional(),
  imageUrl: z.string().max(1000).nullable().optional(),
  imageAlt: z.string().max(220).nullable().optional(),
  vendor: z.string().max(180).nullable().optional(),
  productType: z.string().max(180).nullable().optional(),
  price: z.string().max(80).nullable().optional(),
  status: z.string().max(80).nullable().optional(),
  riskScore: z.number().min(0).max(100).nullable().optional(),
  riskLabel: z.string().max(40).nullable().optional(),
  updatedAt: z.string().max(80).nullable().optional(),
  metrics: z.array(z.object({
    label: z.string().max(80),
    value: z.union([z.string().max(120), z.number(), z.boolean(), z.null()]),
    detail: z.string().max(160).nullable().optional(),
    trend: z.string().max(80).nullable().optional(),
  }).strict()).max(4).optional(),
}).strict();

const diagnosisSummaryBlockSchema = z.object({
  type: z.literal("diagnosis_summary"),
  productGid: z.string().max(320).optional(),
  title: z.string().max(220).optional(),
  summary: z.string().max(500).nullable().optional(),
  likelyCause: z.string().max(260).nullable().optional(),
  riskScore: z.number().min(0).max(100).nullable().optional(),
  confidence: z.number().min(0).max(100).nullable().optional(),
  issues: z.array(z.string().max(220)).max(8).optional(),
  updatedAt: z.string().max(80).nullable().optional(),
}).strict();

const evidenceListBlockSchema = z.object({
  type: z.literal("evidence_list"),
  productGid: z.string().max(320).optional(),
  title: z.string().max(160).optional(),
  summary: z.string().max(520).nullable().optional(),
  items: z.array(z.object({
    source: z.string().max(120),
    quote: z.string().max(420),
    weight: z.string().max(180).nullable().optional(),
  }).strict()).max(8),
}).strict();

const metricTableBlockSchema = z.object({
  type: z.literal("metric_table"),
  title: z.string().max(160).optional(),
  rows: z.array(z.object({
    label: z.string().max(120),
    value: z.union([z.string().max(160), z.number(), z.boolean(), z.null()]),
    detail: z.string().max(220).nullable().optional(),
  }).strict()).max(12),
}).strict();

const entityListBlockSchema = z.object({
  type: z.literal("entity_list"),
  title: z.string().max(160).optional(),
  emptyMessage: z.string().max(260).nullable().optional(),
  items: z.array(z.object({
    entityType: z.enum(["product", "diagnosis", "watchlist", "analytics", "activity", "recommendation", "source"]).optional(),
    id: z.string().max(320).optional(),
    title: z.string().max(220),
    subtitle: z.string().max(260).nullable().optional(),
    detail: z.string().max(260).nullable().optional(),
    productGid: z.string().max(320).optional(),
    handle: z.string().max(180).optional(),
    status: z.string().max(80).nullable().optional(),
    riskScore: z.number().min(0).max(100).nullable().optional(),
    riskLabel: z.string().max(40).nullable().optional(),
  }).strict()).max(8),
}).strict();

const recommendationListBlockSchema = z.object({
  type: z.literal("recommendation_list"),
  productGid: z.string().max(320).optional(),
  title: z.string().max(160).optional(),
  emptyMessage: z.string().max(260).nullable().optional(),
  items: z.array(z.object({
    id: z.string().max(160),
    label: z.string().max(220),
    status: z.string().max(80).nullable().optional(),
    issue: z.string().max(220).nullable().optional(),
    effort: z.string().max(80).nullable().optional(),
    impact: z.string().max(120).nullable().optional(),
    risk: z.string().max(80).nullable().optional(),
    confidence: z.string().max(80).nullable().optional(),
    expectedResult: z.string().max(260).nullable().optional(),
    draftPreview: z.string().max(320).nullable().optional(),
  }).strict()).max(10),
}).strict();

const unavailableStateBlockSchema = z.object({
  type: z.literal("unavailable_state"),
  title: z.string().max(160),
  message: z.string().max(500),
  reason: z.string().max(260).nullable().optional(),
  nextStep: z.string().max(260).nullable().optional(),
}).strict();

const actionProposalBlockSchema = z.object({
  type: z.literal("action_proposal"),
  proposalId: z.string().max(320),
  actionName: z.string().max(160),
  title: z.string().max(220),
  summary: z.string().max(800),
  targetType: z.string().max(80),
  targetId: z.string().max(320),
  targetLabel: z.string().max(220).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
  expectedResult: z.string().max(600).nullable().optional(),
  risks: z.array(z.string().max(280)).max(6).default([]),
  confirmationLevel: z.enum(["low", "medium", "high"]),
  sideEffectLevel: z.enum(["low", "medium", "high"]),
  reversible: z.boolean(),
  expiresAt: z.string().max(80),
}).strict();

const actionResultBlockSchema = z.object({
  type: z.literal("action_result"),
  actionName: z.string().max(160),
  status: z.enum(["success", "error", "cancelled"]),
  title: z.string().max(220),
  summary: z.string().max(800),
  targetLabel: z.string().max(220).nullable().optional(),
  sideEffectLevel: z.enum(["low", "medium", "high"]).nullable().optional(),
  affectedEntities: z.array(z.object({
    type: z.string().max(80),
    id: z.string().max(320),
    label: z.string().max(220).nullable().optional(),
  }).strict()).max(6).default([]),
  createdJobId: z.string().max(320).nullable().optional(),
}).strict();

const appDraftEditableFieldSchema = z.object({
  name: z.string().max(80),
  label: z.string().max(160),
  value: z.string().max(8000),
  fieldType: z.enum(["text", "textarea", "select"]),
  required: z.boolean().optional(),
  maxLength: z.number().int().min(1).max(10000).optional(),
  options: z.array(z.object({
    label: z.string().max(120),
    value: z.string().max(120),
  }).strict()).max(12).optional(),
}).strict();

const appDraftProposalBlockSchema = z.object({
  type: z.literal("app_draft_proposal"),
  proposalId: z.string().max(320),
  mutationName: z.string().max(180),
  draftType: z.enum(["product_description", "seo", "metafield_value", "recommendation_text", "internal_note", "other"]),
  title: z.string().max(220),
  summary: z.string().max(800),
  targetType: z.string().max(80),
  targetId: z.string().max(320),
  targetLabel: z.string().max(220).nullable().optional(),
  proposedValue: z.record(z.string(), z.string().max(1200)).default({}),
  currentAppValueSnapshot: z.record(z.string(), z.string().max(1200)).default({}),
  generatedReason: z.string().max(700).nullable().optional(),
  validationWarnings: z.array(z.string().max(260)).max(8).default([]),
  editableFields: z.array(appDraftEditableFieldSchema).max(8),
  confirmationLevel: z.enum(["low", "medium", "high"]),
  sideEffectLevel: z.enum(["low", "medium", "high"]),
  reversible: z.boolean(),
  expiresAt: z.string().max(80),
}).strict();

const appDraftResultBlockSchema = z.object({
  type: z.literal("app_draft_result"),
  mutationName: z.string().max(180),
  status: z.enum(["success", "error", "cancelled"]),
  title: z.string().max(220),
  summary: z.string().max(800),
  targetLabel: z.string().max(220).nullable().optional(),
  sideEffectLevel: z.enum(["low", "medium", "high"]).nullable().optional(),
  affectedEntities: z.array(z.object({
    type: z.string().max(80),
    id: z.string().max(320),
    label: z.string().max(220).nullable().optional(),
  }).strict()).max(6).default([]),
  savedRecordId: z.string().max(320).nullable().optional(),
  primaryAction: z.object({
    label: z.string().max(80),
    type: z.enum(["open_product", "open_recommendation"]),
    payload: z.record(z.string(), z.string().max(320)).default({}),
  }).strict().nullable().optional(),
}).strict();

const scoreExplanationBlockSchema = z.object({
  type: z.literal("score_explanation"),
  scoreName: z.string().max(160),
  meaning: z.string().max(500),
  logic: z.string().max(900),
  formula: z.string().max(500).nullable().optional(),
  range: z.string().max(120).nullable().optional(),
  inputs: z.array(z.string().max(180)).max(8).default([]),
  thresholds: z.array(z.object({
    label: z.string().max(120),
    value: z.string().max(120),
    meaning: z.string().max(220),
  }).strict()).max(8).default([]),
  interpretation: z.array(z.string().max(260)).max(6).default([]),
  caveats: z.array(z.string().max(260)).max(6).default([]),
}).strict();

const processGuideBlockSchema = z.object({
  type: z.literal("process_guide"),
  title: z.string().max(180),
  summary: z.string().max(700),
  steps: z.array(z.object({
    label: z.string().max(120),
    detail: z.string().max(260),
  }).strict()).max(8).default([]),
  inputs: z.array(z.string().max(180)).max(8).default([]),
  outputs: z.array(z.string().max(180)).max(8).default([]),
  limitations: z.array(z.string().max(260)).max(6).default([]),
}).strict();

const screenGuideBlockSchema = z.object({
  type: z.literal("screen_guide"),
  screenName: z.string().max(160),
  purpose: z.string().max(600),
  dataShown: z.array(z.string().max(180)).max(8).default([]),
  howToRead: z.array(z.string().max(220)).max(8).default([]),
  commonActions: z.array(z.string().max(180)).max(8).default([]),
  caveats: z.array(z.string().max(260)).max(6).default([]),
}).strict();

const settingExplanationBlockSchema = z.object({
  type: z.literal("setting_explanation"),
  settingName: z.string().max(160),
  meaning: z.string().max(600),
  defaultValue: z.string().max(120).nullable().optional(),
  allowedValues: z.array(z.string().max(160)).max(8).default([]),
  effect: z.string().max(700),
  caveats: z.array(z.string().max(260)).max(6).default([]),
}).strict();

export const aiPresentationBlockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  productReferenceBlockSchema,
  diagnosisSummaryBlockSchema,
  evidenceListBlockSchema,
  metricTableBlockSchema,
  entityListBlockSchema,
  recommendationListBlockSchema,
  unavailableStateBlockSchema,
  actionProposalBlockSchema,
  actionResultBlockSchema,
  appDraftProposalBlockSchema,
  appDraftResultBlockSchema,
  scoreExplanationBlockSchema,
  processGuideBlockSchema,
  screenGuideBlockSchema,
  settingExplanationBlockSchema,
]);

export type AiPresentationBlock = z.infer<typeof aiPresentationBlockSchema>;

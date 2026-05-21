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
  riskScore: z.number().min(0).max(100).nullable().optional(),
  riskLabel: z.string().max(40).nullable().optional(),
}).strict();

const diagnosisSummaryBlockSchema = z.object({
  type: z.literal("diagnosis_summary"),
  productGid: z.string().max(320).optional(),
  title: z.string().max(220).optional(),
  likelyCause: z.string().max(260).nullable().optional(),
  riskScore: z.number().min(0).max(100).nullable().optional(),
  confidence: z.number().min(0).max(100).nullable().optional(),
  issues: z.array(z.string().max(220)).max(8).optional(),
}).strict();

const evidenceListBlockSchema = z.object({
  type: z.literal("evidence_list"),
  productGid: z.string().max(320).optional(),
  title: z.string().max(160).optional(),
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
]);

export type AiPresentationBlock = z.infer<typeof aiPresentationBlockSchema>;

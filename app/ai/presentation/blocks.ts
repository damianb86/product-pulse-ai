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

export const aiPresentationBlockSchema = z.discriminatedUnion("type", [
  textBlockSchema,
  productReferenceBlockSchema,
  diagnosisSummaryBlockSchema,
  evidenceListBlockSchema,
  metricTableBlockSchema,
  actionProposalBlockSchema,
]);

export type AiPresentationBlock = z.infer<typeof aiPresentationBlockSchema>;

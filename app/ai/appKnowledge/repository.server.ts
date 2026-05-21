import {
  APP_CONCEPT_EXPLANATIONS,
  APP_KNOWLEDGE_SNIPPETS,
  APP_SCORE_EXPLANATIONS,
  APP_SCREEN_GUIDES,
  APP_SETTING_EXPLANATIONS,
} from "./knowledgeBase";
import type {
  AppConceptExplanation,
  AppKnowledgeAudience,
  AppKnowledgeSearchItem,
  AppKnowledgeSearchResult,
  AppKnowledgeSnippet,
  AppKnowledgeSourceReference,
  AppKnowledgeTopic,
  AppScoreExplanation,
  AppScreenGuide,
  AppSettingExplanation,
} from "./types";

const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 8;

export class AppKnowledgeRepository {
  constructor(private readonly snippets: AppKnowledgeSnippet[] = APP_KNOWLEDGE_SNIPPETS) {}

  search(input: {
    query: string;
    topic?: AppKnowledgeTopic;
    limit?: number;
    audience?: AppKnowledgeAudience;
  }): AppKnowledgeSearchResult {
    const query = input.query.trim();
    const audience = input.audience || "merchant";
    const limit = normalizeKnowledgeLimit(input.limit);
    const queryTokens = tokenize(query);

    const scored = this.snippets
      .filter((snippet) => !input.topic || snippet.topic === input.topic)
      .map((snippet) => ({ snippet, score: scoreSnippet(snippet, queryTokens, query, input.topic) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.snippet.title.localeCompare(b.snippet.title))
      .slice(0, limit)
      .map((item) => toSearchItem(item.snippet, audience, queryTokens));

    return {
      query,
      topic: input.topic,
      results: scored,
    };
  }

  getConceptExplanation(conceptName: string, audience: AppKnowledgeAudience = "merchant"): AppConceptExplanation {
    const concept = findNamed(APP_CONCEPT_EXPLANATIONS, conceptName, (item) => [
      item.conceptName,
      ...item.relatedConcepts,
    ]);
    if (!concept) {
      return {
        found: false,
        conceptName,
        explanation: "ProductPulse does not have a documented explanation for that concept yet.",
        relatedConcepts: suggestRelatedConcepts(conceptName),
        confidence: "low",
      };
    }
    return redactConcept(concept, audience);
  }

  getScoreExplanation(scoreName: string, audience: AppKnowledgeAudience = "merchant"): AppScoreExplanation {
    const score = findNamed(APP_SCORE_EXPLANATIONS, scoreName, (item) => [
      item.scoreName,
      ...item.inputs,
      ...item.thresholds.map((threshold) => threshold.label),
    ]);
    if (!score) {
      return {
        found: false,
        scoreName,
        meaning: "ProductPulse does not have a documented score or formula with that name.",
        logic: "Unknown in the curated app knowledge base.",
        inputs: [],
        thresholds: [],
        interpretation: ["Ask about a documented score such as risk, confidence, impact, priority, coverage, or Product Momentum."],
        caveats: ["The assistant should not invent missing formulas."],
        confidence: "low",
      };
    }
    return redactScore(score, audience);
  }

  getScreenGuide(screenName: string, audience: AppKnowledgeAudience = "merchant"): AppScreenGuide {
    const screen = findNamed(APP_SCREEN_GUIDES, screenName, (item) => [
      item.screenName,
      item.purpose,
      ...item.dataShown,
      ...item.commonActions,
    ]);
    if (!screen) {
      return {
        found: false,
        screenName,
        purpose: "ProductPulse does not have a documented guide for that screen yet.",
        dataShown: [],
        howToRead: [],
        commonActions: [],
        caveats: ["The assistant should not invent screen behavior."],
        confidence: "low",
      };
    }
    return redactScreen(screen, audience);
  }

  getSettingExplanation(settingName: string, audience: AppKnowledgeAudience = "merchant"): AppSettingExplanation {
    const setting = findNamed(APP_SETTING_EXPLANATIONS, settingName, (item) => [
      item.settingName,
      item.meaning,
      item.effect,
    ]);
    if (!setting) {
      return {
        found: false,
        settingName,
        meaning: "ProductPulse does not have a documented setting with that name.",
        allowedValues: [],
        effect: "Unknown in the curated app knowledge base.",
        caveats: ["The assistant should not invent setting defaults or effects."],
        confidence: "low",
      };
    }
    return redactSetting(setting, audience);
  }
}

export function normalizeKnowledgeLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SEARCH_LIMIT;
  return Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.trunc(numeric)));
}

function scoreSnippet(
  snippet: AppKnowledgeSnippet,
  queryTokens: string[],
  rawQuery: string,
  topic?: AppKnowledgeTopic,
): number {
  const haystack = normalizeText([
    snippet.title,
    snippet.summary,
    snippet.body,
    snippet.topic,
    ...snippet.keywords,
    ...(snippet.aliases || []),
  ].join(" "));
  const normalizedQuery = normalizeText(rawQuery);
  let score = topic && snippet.topic === topic ? 2 : 0;
  if (normalizedQuery && haystack.includes(normalizedQuery)) score += 5;
  for (const token of queryTokens) {
    if (!token) continue;
    if (normalizeText(snippet.title).includes(token)) score += 4;
    if (snippet.keywords.some((keyword) => normalizeText(keyword).includes(token))) score += 3;
    if (snippet.aliases?.some((alias) => normalizeText(alias).includes(token))) score += 3;
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function toSearchItem(
  snippet: AppKnowledgeSnippet,
  audience: AppKnowledgeAudience,
  queryTokens: string[],
): AppKnowledgeSearchItem {
  return {
    id: snippet.id,
    topic: snippet.topic,
    title: snippet.title,
    summary: snippet.summary,
    snippet: bestSnippet(snippet, queryTokens),
    source: redactSource(snippet.source, audience),
    confidence: snippet.confidence,
    lastUpdated: snippet.lastUpdated,
  };
}

function bestSnippet(snippet: AppKnowledgeSnippet, queryTokens: string[]): string {
  const sentences = snippet.body.split(/(?<=[.!?])\s+/).filter(Boolean);
  const matched = sentences.find((sentence) => {
    const normalized = normalizeText(sentence);
    return queryTokens.some((token) => normalized.includes(token));
  });
  return truncateKnowledgeText(matched || snippet.body || snippet.summary, 420);
}

function findNamed<T>(items: T[], query: string, names: (item: T) => string[]): T | null {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return null;
  return items.find((item) => names(item).some((name) => normalizeText(name) === normalizedQuery))
    || items.find((item) => names(item).some((name) => normalizeText(name).includes(normalizedQuery) || normalizedQuery.includes(normalizeText(name))))
    || null;
}

function suggestRelatedConcepts(query: string): string[] {
  const results = new AppKnowledgeRepository().search({ query, limit: 3 }).results;
  return results.map((item) => item.title);
}

function redactConcept(concept: AppConceptExplanation, audience: AppKnowledgeAudience): AppConceptExplanation {
  return {
    ...concept,
    source: concept.source ? redactSource(concept.source, audience) : undefined,
  };
}

function redactScore(score: AppScoreExplanation, audience: AppKnowledgeAudience): AppScoreExplanation {
  return {
    ...score,
    source: score.source ? redactSource(score.source, audience) : undefined,
  };
}

function redactScreen(screen: AppScreenGuide, audience: AppKnowledgeAudience): AppScreenGuide {
  return {
    ...screen,
    source: screen.source ? redactSource(screen.source, audience) : undefined,
  };
}

function redactSetting(setting: AppSettingExplanation, audience: AppKnowledgeAudience): AppSettingExplanation {
  return {
    ...setting,
    source: setting.source ? redactSource(setting.source, audience) : undefined,
  };
}

function redactSource(source: AppKnowledgeSourceReference, audience: AppKnowledgeAudience): AppKnowledgeSourceReference {
  if (audience === "developer") return source;
  return {
    documentTitle: source.documentTitle,
    section: source.section,
  };
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 16);
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function truncateKnowledgeText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}...`;
}

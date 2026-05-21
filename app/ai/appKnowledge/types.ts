export const APP_KNOWLEDGE_TOPICS = [
  "overview",
  "quick_analysis",
  "deep_analysis",
  "candidate_selection",
  "scoring",
  "watchlist",
  "dashboard",
  "analytics",
  "settings",
  "recommended_actions",
  "app_owned_actions",
  "glossary",
] as const;

export type AppKnowledgeTopic = typeof APP_KNOWLEDGE_TOPICS[number];
export type AppKnowledgeAudience = "merchant" | "developer";
export type AppKnowledgeConfidence = "high" | "medium" | "low";

export interface AppKnowledgeSourceReference {
  documentTitle: string;
  documentPath?: string;
  section: string;
  implementationRefs?: string[];
}

export interface AppKnowledgeSnippet {
  id: string;
  topic: AppKnowledgeTopic;
  title: string;
  summary: string;
  body: string;
  keywords: string[];
  aliases?: string[];
  source: AppKnowledgeSourceReference;
  confidence: AppKnowledgeConfidence;
  lastUpdated: string;
}

export interface AppKnowledgeSearchItem {
  id: string;
  topic: AppKnowledgeTopic;
  title: string;
  summary: string;
  snippet: string;
  source: AppKnowledgeSourceReference;
  confidence: AppKnowledgeConfidence;
  lastUpdated: string;
}

export interface AppKnowledgeSearchResult {
  query: string;
  topic?: AppKnowledgeTopic;
  results: AppKnowledgeSearchItem[];
}

export interface AppConceptExplanation {
  found: boolean;
  conceptName: string;
  explanation: string;
  relatedConcepts: string[];
  source?: AppKnowledgeSourceReference;
  confidence: AppKnowledgeConfidence;
}

export interface AppScoreThreshold {
  label: string;
  value: string;
  meaning: string;
}

export interface AppScoreExplanation {
  found: boolean;
  scoreName: string;
  meaning: string;
  logic: string;
  formula?: string;
  range?: string;
  inputs: string[];
  thresholds: AppScoreThreshold[];
  interpretation: string[];
  caveats: string[];
  source?: AppKnowledgeSourceReference;
  confidence: AppKnowledgeConfidence;
}

export interface AppScreenGuide {
  found: boolean;
  screenName: string;
  purpose: string;
  dataShown: string[];
  howToRead: string[];
  commonActions: string[];
  caveats: string[];
  source?: AppKnowledgeSourceReference;
  confidence: AppKnowledgeConfidence;
}

export interface AppSettingExplanation {
  found: boolean;
  settingName: string;
  meaning: string;
  allowedValues: string[];
  defaultValue?: string;
  effect: string;
  caveats: string[];
  source?: AppKnowledgeSourceReference;
  confidence: AppKnowledgeConfidence;
}

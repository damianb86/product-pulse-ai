import { AppKnowledgeRepository } from "./repository.server";
import type { AppKnowledgeAudience, AppKnowledgeTopic } from "./types";

export class AppKnowledgeSearchService {
  constructor(private readonly repository: AppKnowledgeRepository = new AppKnowledgeRepository()) {}

  search(input: {
    query: string;
    topic?: AppKnowledgeTopic;
    limit?: number;
    audience?: AppKnowledgeAudience;
  }) {
    return this.repository.search(input);
  }
}

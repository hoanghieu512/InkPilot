export interface ArticleToScore {
  id: number;
  title: string;
  contentSnippet: string | null;
  sourceSlug: string;
  sourceName: string;
  language: string;
  publishedAt: string | null;
}

export interface FilterResult {
  articleId: number;
  score: number;
  category: string;
  reasoning: string;
  suggestedAngle: string;
  tokensIn: number;
  tokensOut: number;
}

export interface BatchFilterResult {
  results: FilterResult[];
  totalTokensIn: number;
  totalTokensOut: number;
  estimatedCostUsd: number;
  hotCount: number;
  otherCount: number;
  dismissedCount: number;
}

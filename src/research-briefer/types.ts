export interface RelatedArticle {
  id: number;
  title: string;
  sourceSlug: string;
  sourceName: string;
  publishedAt: string;
  score: number;
  url: string;
}

export interface SuggestedAngles {
  vietnamese: string[];
  english: string[];
}

export interface Brief {
  articleId: number;
  articleTitle: string;
  articleUrl: string;
  sourceSlug: string;
  sourceName: string;
  publishedAt: string;
  score: number;

  whyItMatters: string;
  relatedArticles: RelatedArticle[];
  suggestedAngles: SuggestedAngles;

  cached: boolean;
  tokensIn?: number;
  tokensOut?: number;
  estimatedCostUsd?: number;

  /** Set when angle markdown was written by `exportAngleFile` */
  savedAnglePath?: string;
}

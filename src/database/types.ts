export type ArticleState = 'new' | 'read' | 'starred' | 'drafted' | 'posted' | 'dismissed';

export type SourceCategory = 'crypto' | 'protocol' | 'defi' | 'ai' | 'dev' | 'vietnamese' | 'protocol-l2' | 'research-technical';

export interface Source {
  id: number;
  slug: string;
  name: string;
  url: string;
  category: SourceCategory;
  tier: number;
  fetch_interval_minutes: number;
  enabled: number;
  language: string;
  last_fetched_at: string | null;
  created_at: string;
}

export interface Article {
  id: number;
  url: string;
  title: string;
  content: string | null;
  summary: string | null;
  author: string | null;
  published_at: string | null;
  source_id: number | null;
  og_image_url: string | null;
  fetched_at: string;
  raw_data: string | null;
}

export interface ArticleStateRow {
  id: number;
  article_id: number;
  state: ArticleState;
  updated_at: string;
}

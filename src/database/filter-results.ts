import type Database from 'better-sqlite3';
import { getDb } from './index.js';
import type { FilterResult } from '../content-filter/types.js';

export interface FilterResultRow {
  id: number;
  article_id: number;
  score: number;
  category: string | null;
  reasoning: string | null;
  suggested_angle: string | null;
  ai_context: string | null;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  scored_at: string;
}

export function insertFilterResult(result: FilterResult, db?: Database.Database): void {
  const conn = db ?? getDb();
  conn.prepare(`
    INSERT OR IGNORE INTO filter_results (article_id, score, category, reasoning, suggested_angle, model, input_tokens, output_tokens)
    VALUES (@article_id, @score, @category, @reasoning, @suggested_angle, @model, @input_tokens, @output_tokens)
  `).run({
    article_id: result.articleId,
    score: result.score,
    category: result.category,
    reasoning: result.reasoning,
    suggested_angle: result.suggestedAngle,
    model: 'haiku',
    input_tokens: result.tokensIn,
    output_tokens: result.tokensOut,
  });
}

export function isArticleScored(articleId: number, db?: Database.Database): boolean {
  const conn = db ?? getDb();
  const row = conn.prepare('SELECT 1 FROM filter_results WHERE article_id = ?').get(articleId);
  return row != null;
}

export function getFilterResult(articleId: number, db?: Database.Database): FilterResultRow | undefined {
  const conn = db ?? getDb();
  return conn.prepare('SELECT * FROM filter_results WHERE article_id = ?').get(articleId) as FilterResultRow | undefined;
}

export function getFilterResultsByMinScore(minScore: number, db?: Database.Database): FilterResultRow[] {
  const conn = db ?? getDb();
  return conn.prepare('SELECT * FROM filter_results WHERE score >= ? ORDER BY score DESC').all(minScore) as FilterResultRow[];
}

export function getUnscoredArticleIds(articleIds: number[], db?: Database.Database): number[] {
  const conn = db ?? getDb();
  if (articleIds.length === 0) return [];

  const placeholders = articleIds.map(() => '?').join(',');
  const scored = conn.prepare(
    `SELECT article_id FROM filter_results WHERE article_id IN (${placeholders})`
  ).all(...articleIds) as Array<{ article_id: number }>;

  const scoredSet = new Set(scored.map((r) => r.article_id));
  return articleIds.filter((id) => !scoredSet.has(id));
}

export function cacheArticleBrief(articleId: number, briefJson: string, db?: Database.Database): void {
  const conn = db ?? getDb();
  conn.prepare('UPDATE filter_results SET ai_context = ? WHERE article_id = ?').run(briefJson, articleId);
}

export function getCachedBrief(articleId: number, db?: Database.Database): string | null {
  const conn = db ?? getDb();
  const row = conn.prepare('SELECT ai_context FROM filter_results WHERE article_id = ?').get(articleId) as { ai_context: string | null } | undefined;
  return row?.ai_context ?? null;
}

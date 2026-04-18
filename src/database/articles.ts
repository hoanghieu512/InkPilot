import type Database from 'better-sqlite3';
import { getDb } from './index.js';
import type { Article, ArticleState } from './types.js';

export interface InsertArticle {
  url: string;
  title: string;
  content?: string | undefined;
  summary?: string | undefined;
  author?: string | undefined;
  published_at?: string | undefined;
  source_id?: number | undefined;
  og_image_url?: string | undefined;
  raw_data?: string | undefined;
}

export interface InsertResult {
  inserted: boolean;
  id?: number | undefined;
}

export function insertArticle(article: InsertArticle, db?: Database.Database): InsertResult {
  const conn = db ?? getDb();
  const result = conn.prepare(`
    INSERT OR IGNORE INTO articles (url, title, content, summary, author, published_at, source_id, og_image_url, raw_data)
    VALUES (@url, @title, @content, @summary, @author, @published_at, @source_id, @og_image_url, @raw_data)
  `).run({
    url: article.url,
    title: article.title,
    content: article.content ?? null,
    summary: article.summary ?? null,
    author: article.author ?? null,
    published_at: article.published_at ?? null,
    source_id: article.source_id ?? null,
    og_image_url: article.og_image_url ?? null,
    raw_data: article.raw_data ?? null,
  });

  if (result.changes === 0) {
    return { inserted: false };
  }
  return { inserted: true, id: Number(result.lastInsertRowid) };
}

export function updateOgImage(articleId: number, ogImageUrl: string, db?: Database.Database): void {
  const conn = db ?? getDb();
  conn.prepare('UPDATE articles SET og_image_url = ? WHERE id = ?').run(ogImageUrl, articleId);
}

export function getArticleById(id: number, db?: Database.Database): Article | undefined {
  const conn = db ?? getDb();
  return conn.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Article | undefined;
}

export function getArticlesToday(limit: number = 50, db?: Database.Database): Article[] {
  const conn = db ?? getDb();
  return conn.prepare(`
    SELECT * FROM articles
    WHERE fetched_at >= datetime('now', '-24 hours')
    ORDER BY fetched_at DESC
    LIMIT ?
  `).all(limit) as Article[];
}

export interface ArticleFilterOpts {
  state?: ArticleState | undefined;
  limit?: number | undefined;
  today?: boolean | undefined;
  sourceSlug?: string | undefined;
}

export interface ArticleListRow extends Article {
  source_slug: string | null;
  source_name: string | null;
  article_state: string | null;
}

export function getArticlesWithFilter(opts: ArticleFilterOpts, db?: Database.Database): ArticleListRow[] {
  const conn = db ?? getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.today) {
    conditions.push("a.fetched_at >= datetime('now', '-24 hours')");
  }

  if (opts.state) {
    conditions.push('ast.state = ?');
    params.push(opts.state);
  }

  if (opts.sourceSlug) {
    conditions.push('s.slug = ?');
    params.push(opts.sourceSlug);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit ?? 20;

  const sql = `
    SELECT a.*, s.slug as source_slug, s.name as source_name, ast.state as article_state
    FROM articles a
    LEFT JOIN sources s ON a.source_id = s.id
    LEFT JOIN article_states ast ON a.id = ast.article_id
    ${where}
    ORDER BY a.fetched_at DESC
    LIMIT ?
  `;

  return conn.prepare(sql).all(...params, limit) as ArticleListRow[];
}

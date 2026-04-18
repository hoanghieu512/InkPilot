import type Database from 'better-sqlite3';
import { getDb } from './index.js';
import type { ArticleState, ArticleStateRow } from './types.js';

export function createArticleState(articleId: number, state: ArticleState = 'new', db?: Database.Database): void {
  const conn = db ?? getDb();
  conn.prepare(`
    INSERT OR IGNORE INTO article_states (article_id, state)
    VALUES (?, ?)
  `).run(articleId, state);
}

export function updateArticleState(articleId: number, state: ArticleState, db?: Database.Database): void {
  const conn = db ?? getDb();
  conn.prepare(`
    UPDATE article_states SET state = ?, updated_at = datetime('now')
    WHERE article_id = ?
  `).run(state, articleId);
}

export function getArticleState(articleId: number, db?: Database.Database): ArticleStateRow | undefined {
  const conn = db ?? getDb();
  return conn.prepare('SELECT * FROM article_states WHERE article_id = ?').get(articleId) as ArticleStateRow | undefined;
}

import type Database from 'better-sqlite3';
import { getDb } from './index.js';

export interface InsertPost {
  draft_id?: number | undefined;
  article_id?: number | undefined;
  platform: 'x';
  platform_post_id: string;
  platform_post_url?: string | undefined;
  content_snapshot: string;
}

export interface Post {
  id: number;
  draft_id?: number | undefined;
  article_id?: number | undefined;
  platform: 'x';
  platform_post_id: string;
  platform_post_url?: string | undefined;
  content_snapshot: string;
  posted_at: string;
}

function toPost(row: Record<string, unknown>): Post {
  const draft_id = row['draft_id'] as number | null;
  const article_id = row['article_id'] as number | null;
  const platform_post_url = row['platform_post_url'] as string | null;

  return {
    id: row['id'] as number,
    ...(draft_id != null ? { draft_id } : {}),
    ...(article_id != null ? { article_id } : {}),
    platform: row['platform'] as 'x',
    platform_post_id: row['platform_post_id'] as string,
    ...(platform_post_url != null ? { platform_post_url } : {}),
    content_snapshot: row['content_snapshot'] as string,
    posted_at: row['posted_at'] as string,
  };
}

export function insertPost(post: InsertPost, db?: Database.Database): Post {
  const conn = db ?? getDb();
  const stmt = conn.prepare(`
    INSERT INTO posts (draft_id, article_id, platform, platform_post_id, platform_post_url, content_snapshot)
    VALUES (@draft_id, @article_id, @platform, @platform_post_id, @platform_post_url, @content_snapshot)
  `);

  const result = stmt.run({
    draft_id: post.draft_id ?? null,
    article_id: post.article_id ?? null,
    platform: post.platform,
    platform_post_id: post.platform_post_id,
    platform_post_url: post.platform_post_url ?? null,
    content_snapshot: post.content_snapshot,
  });

  return getPostById(Number(result.lastInsertRowid), conn)!;
}

export function getPostById(id: number, db?: Database.Database): Post | undefined {
  const conn = db ?? getDb();
  const row = conn.prepare('SELECT * FROM posts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? toPost(row) : undefined;
}

export function getPostsByPlatform(platform: string, limit: number = 50, db?: Database.Database): Post[] {
  const conn = db ?? getDb();
  const rows = conn
    .prepare('SELECT * FROM posts WHERE platform = ? ORDER BY posted_at DESC LIMIT ?')
    .all(platform, limit) as Array<Record<string, unknown>>;
  return rows.map(toPost);
}

export function countTodayPosts(platform: string, db?: Database.Database): number {
  const conn = db ?? getDb();
  const row = conn
    .prepare("SELECT COUNT(*) as count FROM posts WHERE platform = ? AND date(posted_at) = date('now')")
    .get(platform) as { count: number };
  return row.count;
}

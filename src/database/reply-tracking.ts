import type Database from 'better-sqlite3';
import { getDb } from './index.js';
import type { Niche } from '../config/kol-niches.js';
import type { ReplyEnrichment } from '../reply-tracking/types.js';

export interface InsertReply {
  post_id: string;
  post_url: string | null;
  posted_date: string;
  post_text: string;
  kol_handle: string | null;
  niche: Niche;
  impressions: number;
  engagements: number;
  new_follows: number;
}

export interface ReplyRow {
  id: number;
  post_id: string;
  post_url: string | null;
  posted_date: string;
  post_text: string | null;
  kol_handle: string | null;
  niche: Niche;
  impressions: number;
  engagements: number;
  new_follows: number;
  parent_tweet_id: string | null;
  parent_impressions: number | null;
  parent_engagements: number | null;
  reply_created_at: string | null;
  hour: number | null;
  enriched_at: string | null;
  created_at: string;
  updated_at: string;
}

export function upsertReply(reply: InsertReply, db?: Database.Database): void {
  const conn = db ?? getDb();
  conn.prepare(`
    INSERT INTO reply_tracking
      (post_id, post_url, posted_date, post_text, kol_handle, niche, impressions, engagements, new_follows)
    VALUES
      (@post_id, @post_url, @posted_date, @post_text, @kol_handle, @niche, @impressions, @engagements, @new_follows)
    ON CONFLICT(post_id) DO UPDATE SET
      post_url = excluded.post_url,
      posted_date = excluded.posted_date,
      post_text = excluded.post_text,
      kol_handle = excluded.kol_handle,
      niche = excluded.niche,
      impressions = excluded.impressions,
      engagements = excluded.engagements,
      new_follows = excluded.new_follows,
      updated_at = datetime('now')
  `).run({
    post_id: reply.post_id,
    post_url: reply.post_url,
    posted_date: reply.posted_date,
    post_text: reply.post_text,
    kol_handle: reply.kol_handle,
    niche: reply.niche,
    impressions: reply.impressions,
    engagements: reply.engagements,
    new_follows: reply.new_follows,
  });
}

export function updateReplyEnrichment(
  postId: string,
  e: ReplyEnrichment,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();
  conn.prepare(`
    UPDATE reply_tracking SET
      parent_tweet_id = @parent_tweet_id,
      parent_impressions = @parent_impressions,
      parent_engagements = @parent_engagements,
      reply_created_at = @reply_created_at,
      hour = @hour,
      enriched_at = datetime('now'),
      updated_at = datetime('now')
    WHERE post_id = @post_id
  `).run({
    post_id: postId,
    parent_tweet_id: e.parentTweetId,
    parent_impressions: e.parentImpressions,
    parent_engagements: e.parentEngagements,
    reply_created_at: e.replyCreatedAt,
    hour: e.hour,
  });
}

export function getRepliesNeedingEnrichment(db?: Database.Database): ReplyRow[] {
  const conn = db ?? getDb();
  return conn
    .prepare('SELECT * FROM reply_tracking WHERE enriched_at IS NULL ORDER BY posted_date')
    .all() as ReplyRow[];
}

/** Un-enriched replies inside [start, end] — the only rows worth an API call this run. */
export function getRepliesNeedingEnrichmentInPeriod(
  start: string,
  end: string,
  db?: Database.Database,
): ReplyRow[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      'SELECT * FROM reply_tracking WHERE enriched_at IS NULL AND posted_date BETWEEN ? AND ? ORDER BY posted_date',
    )
    .all(start, end) as ReplyRow[];
}

export function getRepliesInPeriod(start: string, end: string, db?: Database.Database): ReplyRow[] {
  const conn = db ?? getDb();
  return conn
    .prepare('SELECT * FROM reply_tracking WHERE posted_date BETWEEN ? AND ? ORDER BY posted_date')
    .all(start, end) as ReplyRow[];
}

export function getAllReplies(db?: Database.Database): ReplyRow[] {
  const conn = db ?? getDb();
  return conn
    .prepare('SELECT * FROM reply_tracking ORDER BY posted_date')
    .all() as ReplyRow[];
}

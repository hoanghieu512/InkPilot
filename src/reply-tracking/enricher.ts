import { requireTwitterApiIoKey } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { EnrichFn, ReplyEnrichment } from './types.js';

const logger = createLogger('reply-tracking:enricher');

const BASE_URL = 'https://api.twitterapi.io';

export interface MappedTweet {
  id: string | null;
  createdAt: string | null;
  authorHandle: string | null;
  inReplyToId: string | null;
  impressions: number | null;
  engagements: number | null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && !isNaN(v) ? v : null;
}

/** Map one TwitterAPI.io tweet object to the fields we use. Tolerant of missing keys. */
export function mapTweet(t: Record<string, unknown>): MappedTweet {
  const author = (t['author'] ?? {}) as Record<string, unknown>;
  const userName = author['userName'] ?? author['username'] ?? author['screen_name'];
  const like = numOrNull(t['likeCount']) ?? 0;
  const rt = numOrNull(t['retweetCount']) ?? 0;
  const rep = numOrNull(t['replyCount']) ?? 0;
  const quote = numOrNull(t['quoteCount']) ?? 0;
  const anyEng = t['likeCount'] !== undefined || t['retweetCount'] !== undefined;
  return {
    id: typeof t['id'] === 'string' ? (t['id'] as string) : t['id'] != null ? String(t['id']) : null,
    createdAt: typeof t['createdAt'] === 'string' ? (t['createdAt'] as string) : null,
    authorHandle: typeof userName === 'string' ? `@${userName}` : null,
    inReplyToId:
      typeof t['inReplyToId'] === 'string'
        ? (t['inReplyToId'] as string)
        : t['inReplyToId'] != null
          ? String(t['inReplyToId'])
          : null,
    impressions: numOrNull(t['viewCount']),
    engagements: anyEng ? like + rt + rep + quote : null,
  };
}

/** UTC ISO/date string → hour-of-day (0-23) in +07:00, or null if unparseable. */
export function computeHourPlus7(createdAt: string | null): number | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getTime() + 7 * 3_600_000).getUTCHours();
}

async function fetchTweet(id: string, apiKey: string): Promise<MappedTweet | null> {
  // VERIFY against https://docs.twitterapi.io — endpoint + param + auth header.
  const res = await fetch(`${BASE_URL}/twitter/tweets?tweet_ids=${encodeURIComponent(id)}`, {
    headers: { 'x-api-key': apiKey },
  });
  if (!res.ok) {
    throw new Error(`TwitterAPI.io ${res.status} for tweet ${id}`);
  }
  const body = (await res.json()) as Record<string, unknown>;
  const arr = (body['tweets'] ?? body['data'] ?? []) as Array<Record<string, unknown>>;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return mapTweet(arr[0]!);
}

/**
 * Enrich a reply: fetch the reply tweet (→ created hour + parent id),
 * then fetch the parent tweet (→ parent author + parent imp/eng).
 * Throws on hard failure; the orchestrator catches per-reply and skips.
 */
export const enrichReply: EnrichFn = async (postId: string): Promise<ReplyEnrichment> => {
  const apiKey = requireTwitterApiIoKey();

  const reply = await fetchTweet(postId, apiKey);
  const replyCreatedAt = reply?.createdAt ?? null;
  const hour = computeHourPlus7(replyCreatedAt);
  const parentId = reply?.inReplyToId ?? null;

  let parentImpressions: number | null = null;
  let parentEngagements: number | null = null;
  let parentAuthorHandle: string | null = null;

  if (parentId) {
    try {
      const parent = await fetchTweet(parentId, apiKey);
      parentImpressions = parent?.impressions ?? null;
      parentEngagements = parent?.engagements ?? null;
      parentAuthorHandle = parent?.authorHandle ?? null;
    } catch (err) {
      logger.warn(`Parent fetch failed for reply ${postId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    replyCreatedAt,
    hour,
    parentTweetId: parentId,
    parentImpressions,
    parentEngagements,
    parentAuthorHandle,
  };
};

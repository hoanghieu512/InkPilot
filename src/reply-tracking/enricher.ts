import { requireTwitterApiIoKey, getTwitterApiIoQps } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { EnrichFn, ReplyEnrichment } from './types.js';

const logger = createLogger('reply-tracking:enricher');

const BASE_URL = 'https://api.twitterapi.io';
const DEFAULT_MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 10_000;

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

/** Backoff for a 429: honor Retry-After (seconds) if present, else exponential, capped. */
export function nextBackoffMs(attempt: number, retryAfterSec?: number): number {
  if (retryAfterSec && retryAfterSec > 0) return retryAfterSec * 1000;
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface EnricherOptions {
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
  /** Max requests/second. Defaults to config (`getTwitterApiIoQps`). */
  qps?: number;
  /** Max 429 retries per request. */
  maxRetries?: number;
  /** Resolved lazily from env when omitted. */
  apiKey?: string;
}

/**
 * A serial rate limiter: spaces consecutive calls at least `minIntervalMs` apart.
 * Enrichment runs sequentially (one reply, then its parent), so no locking needed.
 */
function createRateLimiter(minIntervalMs: number, sleep: (ms: number) => Promise<void>, now: () => number) {
  let last = 0;
  return async function acquire(): Promise<void> {
    const wait = minIntervalMs - (now() - last);
    if (wait > 0) await sleep(wait);
    last = now();
  };
}

/**
 * Build an enricher bound to a single shared throttle + 429 backoff.
 * `enrichReply` (below) is the production instance; tests build their own with mocks.
 */
export function createEnricher(opts: EnricherOptions = {}): EnrichFn {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const qps = opts.qps ?? getTwitterApiIoQps();
  const minIntervalMs = Math.ceil(1000 / qps);
  const acquire = createRateLimiter(minIntervalMs, sleep, now);

  async function fetchTweet(id: string, apiKey: string): Promise<MappedTweet | null> {
    // VERIFY against https://docs.twitterapi.io — endpoint + param + auth header.
    for (let attempt = 0; ; attempt++) {
      await acquire(); // throttle to stay under QPS
      const res = await fetchImpl(`${BASE_URL}/twitter/tweets?tweet_ids=${encodeURIComponent(id)}`, {
        headers: { 'x-api-key': apiKey },
      });
      if (res.status === 429 && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        const delay = nextBackoffMs(attempt, retryAfter);
        logger.warn(`429 for tweet ${id} — retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await sleep(delay);
        continue;
      }
      if (!res.ok) {
        throw new Error(`TwitterAPI.io ${res.status} for tweet ${id}`);
      }
      const body = (await res.json()) as Record<string, unknown>;
      const arr = (body['tweets'] ?? body['data'] ?? []) as Array<Record<string, unknown>>;
      if (!Array.isArray(arr) || arr.length === 0) return null;
      return mapTweet(arr[0]!);
    }
  }

  /**
   * Enrich a reply: fetch the reply tweet (→ created hour + parent id),
   * then fetch the parent tweet (→ parent author + parent imp/eng).
   * Throws on hard failure; the orchestrator catches per-reply and skips.
   */
  return async function enrichReply(postId: string): Promise<ReplyEnrichment> {
    const apiKey = opts.apiKey ?? requireTwitterApiIoKey();

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
}

/** Production enricher: shared throttle from config QPS + 429 backoff. */
export const enrichReply: EnrichFn = createEnricher();

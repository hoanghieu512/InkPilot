import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mapTweet, computeHourPlus7, nextBackoffMs, createEnricher } from '../src/reply-tracking/enricher.js';
import Database from 'better-sqlite3';
import {
  upsertReply,
  updateReplyEnrichment,
  getRepliesNeedingEnrichment,
  getRepliesNeedingEnrichmentInPeriod,
  getRepliesInPeriod,
  getAllReplies,
} from '../src/database/reply-tracking.js';
import type { InsertReply } from '../src/database/reply-tracking.js';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations } from '../src/database/migrations.js';
import { lookupNiche, NICHES } from '../src/config/kol-niches.js';
import {
  parseCsv,
  parseXDate,
  extractKolHandle,
  derivePeriod,
  parseContentCsv,
} from '../src/reply-tracking/csv-parser.js';
import { buildSnapshot, weekStart, nowIsoPlus7 } from '../src/reply-tracking/snapshot-builder.js';
import type { ContentRow } from '../src/reply-tracking/types.js';
import type { ReplyRow } from '../src/database/reply-tracking.js';
import { runReplyAnalyze } from '../src/reply-tracking/index.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('kol-niches', () => {
  it('maps a known security handle', () => {
    expect(lookupNiche('@samczsun')).toBe('security');
  });

  it('is case-insensitive and tolerates missing @', () => {
    expect(lookupNiche('SamCzSun')).toBe('security');
    expect(lookupNiche('@PeckShieldAlert')).toBe('security');
  });

  it('maps tokenomics and l1l2 handles', () => {
    expect(lookupNiche('@DefiIgnas')).toBe('tokenomics');
    expect(lookupNiche('@aeyakovenko')).toBe('l1l2');
  });

  it('falls back to other for unknown handles', () => {
    expect(lookupNiche('@some_rando_123')).toBe('other');
  });

  it('exposes exactly the 4 niches', () => {
    expect([...NICHES]).toEqual(['security', 'tokenomics', 'l1l2', 'other']);
  });
});

describe('csv-parser', () => {
  it('parseCsv handles quoted fields with commas and escaped quotes', () => {
    const text = 'a,b,c\n1,"hello, world","say ""hi"""\n';
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(['a', 'b', 'c']);
    expect(rows[1]).toEqual(['1', 'hello, world', 'say "hi"']);
  });

  it('parseCsv handles newlines inside quoted fields', () => {
    const text = 'a,b\n"line1\nline2",x\n';
    const rows = parseCsv(text);
    expect(rows[1]).toEqual(['line1\nline2', 'x']);
  });

  it('parseXDate converts X date format to ISO', () => {
    expect(parseXDate('Sun, Jun 7, 2026')).toBe('2026-06-07');
    expect(parseXDate('Mon, Jun 1, 2026')).toBe('2026-06-01');
  });

  it('extractKolHandle returns handle for replies, null for originals', () => {
    expect(extractKolHandle('@5phutcrypto_ Vẫn đang chờ')).toBe('@5phutcrypto_');
    expect(extractKolHandle('@samczsun great point')).toBe('@samczsun');
    expect(extractKolHandle('Nay tối chủ nhật nên có vài dòng')).toBeNull();
    expect(extractKolHandle('  @spaced handle')).toBe('@spaced');
  });

  it('derivePeriod returns a 7-day window ending at the max date', () => {
    const p = derivePeriod(['2026-06-07', '2026-06-01', '2026-06-05']);
    expect(p.end).toBe('2026-06-07');
    expect(p.start).toBe('2026-06-01'); // end - 6 days
    expect(p.label).toBe('Jun 1 – Jun 7, 2026');
  });

  it('derivePeriod scopes to the latest week even when CSV spans 28 days', () => {
    const dates = ['2026-05-18', '2026-05-25', '2026-06-08', '2026-06-14'];
    const p = derivePeriod(dates);
    expect(p.end).toBe('2026-06-14');
    expect(p.start).toBe('2026-06-08'); // Jun 14 - 6 days, NOT May 18
    expect(p.label).toBe('Jun 8 – Jun 14, 2026');
  });

  it('parseContentCsv classifies replies vs originals and coerces numbers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkpilot-csv-'));
    const p = join(dir, 'content.csv');
    writeFileSync(
      p,
      [
        'Post id,Date,Post text,Post Link,Impressions,Engagements,New follows',
        '111,"Fri, Jun 5, 2026","@samczsun nice",https://x.com/u/status/111,"1,234",2,1',
        '222,"Fri, Jun 5, 2026","a normal original",https://x.com/u/status/222,500,15,4',
        ',"Fri, Jun 5, 2026","row with no id — skipped",,0,0,0',
      ].join('\n') + '\n',
    );
    const rows = parseContentCsv(p);
    rmSync(dir, { recursive: true, force: true });

    expect(rows).toHaveLength(2); // empty-id row skipped
    const reply = rows.find((r) => r.postId === '111')!;
    expect(reply.isReply).toBe(true);
    expect(reply.kolHandle).toBe('@samczsun');
    expect(reply.impressions).toBe(1234); // comma stripped
    expect(reply.postedDate).toBe('2026-06-05');
    const original = rows.find((r) => r.postId === '222')!;
    expect(original.isReply).toBe(false);
    expect(original.kolHandle).toBeNull();
  });

  it('parseContentCsv skips a row with a valid id but blank date instead of throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'inkpilot-csv-'));
    const p = join(dir, 'content.csv');
    writeFileSync(
      p,
      [
        'Post id,Date,Post text,Post Link,Impressions,Engagements,New follows',
        '333,,"orphan no date",,10,0,0',
        '444,"Fri, Jun 5, 2026","valid",,20,1,0',
      ].join('\n') + '\n',
    );
    const rows = parseContentCsv(p);
    rmSync(dir, { recursive: true, force: true });

    expect(rows.map((r) => r.postId)).toEqual(['444']); // blank-date row skipped, no throw
  });
});

describe('reply-tracking db', () => {
  let db: Database.Database;
  beforeEach(() => { db = createTestDb(); });

  const base: InsertReply = {
    post_id: '111',
    post_url: 'https://x.com/u/status/111',
    posted_date: '2026-06-05',
    post_text: '@samczsun nice',
    kol_handle: '@samczsun',
    niche: 'security',
    impressions: 71,
    engagements: 2,
    new_follows: 1,
  };

  it('upserts a row and reads it back', () => {
    upsertReply(base, db);
    const rows = getAllReplies(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.post_id).toBe('111');
    expect(rows[0]!.impressions).toBe(71);
  });

  it('is idempotent on post_id and updates changed metrics', () => {
    upsertReply(base, db);
    upsertReply({ ...base, impressions: 99 }, db);
    const rows = getAllReplies(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.impressions).toBe(99);
  });

  it('preserves enrichment across a re-upsert of the same CSV row', () => {
    upsertReply(base, db);
    updateReplyEnrichment('111', {
      replyCreatedAt: '2026-06-05T03:00:00.000Z',
      hour: 10,
      parentTweetId: '999',
      parentImpressions: 5000,
      parentEngagements: 120,
      parentAuthorHandle: '@samczsun',
    }, db);
    upsertReply({ ...base, impressions: 99 }, db); // CSV re-run
    const rows = getAllReplies(db);
    expect(rows[0]!.parent_impressions).toBe(5000);
    expect(rows[0]!.hour).toBe(10);
    expect(rows[0]!.enriched_at).not.toBeNull();
  });

  it('getRepliesNeedingEnrichment returns only un-enriched rows', () => {
    upsertReply(base, db);
    upsertReply({ ...base, post_id: '222' }, db);
    updateReplyEnrichment('111', {
      replyCreatedAt: null, hour: 5, parentTweetId: null,
      parentImpressions: null, parentEngagements: null, parentAuthorHandle: null,
    }, db);
    const pending = getRepliesNeedingEnrichment(db);
    expect(pending.map((r) => r.post_id)).toEqual(['222']);
  });

  it('getRepliesInPeriod filters by posted_date inclusive', () => {
    upsertReply({ ...base, post_id: 'a', posted_date: '2026-06-01' }, db);
    upsertReply({ ...base, post_id: 'b', posted_date: '2026-06-07' }, db);
    upsertReply({ ...base, post_id: 'c', posted_date: '2026-06-09' }, db);
    const inPeriod = getRepliesInPeriod('2026-06-01', '2026-06-07', db);
    expect(inPeriod.map((r) => r.post_id).sort()).toEqual(['a', 'b']);
  });

  it('getRepliesNeedingEnrichmentInPeriod returns only un-enriched rows inside the period', () => {
    upsertReply({ ...base, post_id: 'old', posted_date: '2026-05-20' }, db);  // out of period, un-enriched
    upsertReply({ ...base, post_id: 'in1', posted_date: '2026-06-05' }, db);  // in period, un-enriched
    upsertReply({ ...base, post_id: 'in2', posted_date: '2026-06-06' }, db);  // in period, will enrich
    updateReplyEnrichment('in2', {
      replyCreatedAt: '2026-06-06T00:00:00.000Z', hour: 7, parentTweetId: 'p',
      parentImpressions: 1000, parentEngagements: 10, parentAuthorHandle: '@x',
    }, db);
    const pending = getRepliesNeedingEnrichmentInPeriod('2026-06-01', '2026-06-07', db);
    expect(pending.map((r) => r.post_id)).toEqual(['in1']); // not 'old' (out of period), not 'in2' (enriched)
  });
});

describe('snapshot-builder helpers', () => {
  it('weekStart returns the Monday of the week', () => {
    expect(weekStart('2026-06-07')).toBe('2026-06-01'); // Sun → prior Mon
    expect(weekStart('2026-06-01')).toBe('2026-06-01'); // Mon → itself
    expect(weekStart('2026-06-03')).toBe('2026-06-01'); // Wed → Mon
  });

  it('nowIsoPlus7 emits a +07:00 offset', () => {
    const s = nowIsoPlus7(new Date('2026-06-14T00:00:00.000Z'));
    expect(s).toBe('2026-06-14T07:00:00.000+07:00');
  });
});

describe('buildSnapshot', () => {
  const period = { start: '2026-06-01', end: '2026-06-07', label: 'Jun 1 – Jun 7, 2026' };

  function content(over: Partial<ContentRow>): ContentRow {
    return {
      postId: 'x', rawDate: '', postedDate: '2026-06-05', postText: '', postLink: '',
      impressions: 0, engagements: 0, newFollows: 0, isReply: false, kolHandle: null,
      ...over,
    };
  }
  function reply(over: Partial<ReplyRow>): ReplyRow {
    return {
      id: 1, post_id: 'x', post_url: null, posted_date: '2026-06-05', post_text: null,
      kol_handle: '@samczsun', niche: 'security', impressions: 100, engagements: 2, new_follows: 1,
      parent_tweet_id: null, parent_impressions: null, parent_engagements: null,
      reply_created_at: null, hour: null, enriched_at: null,
      created_at: '', updated_at: '', ...over,
    };
  }

  it('computes summary from content rows', () => {
    const rows = [
      content({ isReply: true, impressions: 100, newFollows: 2 }),
      content({ isReply: true, impressions: 40, newFollows: 0 }), // dud
      content({ isReply: false, impressions: 60, newFollows: 5 }),
    ];
    const snap = buildSnapshot(rows, [], [], period, 'NOW');
    expect(snap.summary.replyCount).toBe(2);
    expect(snap.summary.originalCount).toBe(1);
    expect(snap.summary.dudRate).toBe(0.5);
    expect(snap.summary.avgImpPerReply).toBe(70);
    expect(snap.summary.avgImpPerOriginal).toBe(60);
    expect(snap.summary.newFollowsFromReply).toBe(2);
    expect(snap.summary.newFollowsFromOriginal).toBe(5);
    expect(snap.summary.replyImpShare).toBe(0.7); // 140 / 200
  });

  it('summary counts only content rows within the period, not the whole CSV', () => {
    const rows = [
      content({ isReply: true, postedDate: '2026-06-05', impressions: 100, newFollows: 2 }), // in period
      content({ isReply: false, postedDate: '2026-06-06', impressions: 60, newFollows: 5 }), // in period
      content({ isReply: true, postedDate: '2026-05-20', impressions: 999, newFollows: 9 }), // OUT of period
      content({ isReply: false, postedDate: '2026-05-21', impressions: 999, newFollows: 9 }), // OUT of period
    ];
    // periodReplies (DB, latest week) align with the in-period reply
    const periodReplies = [reply({ post_id: 'a', niche: 'security', impressions: 100 })];
    const snap = buildSnapshot(rows, periodReplies, [], period, 'NOW');

    expect(snap.summary.replyCount).toBe(1);    // only the Jun 5 reply, not the May 20 one
    expect(snap.summary.originalCount).toBe(1); // only the Jun 6 original
    expect(snap.summary.newFollowsFromReply).toBe(2); // 9 from out-of-period excluded
    // summary.replyCount must reconcile with the byNiche reply total
    const byNicheReplies = snap.byNiche.reduce((s, n) => s + n.replies, 0);
    expect(snap.summary.replyCount).toBe(byNicheReplies);
  });

  it('byNiche always lists all 4 niches in fixed order', () => {
    const snap = buildSnapshot([], [reply({ niche: 'security' })], [], period, 'NOW');
    expect(snap.byNiche.map((n) => n.niche)).toEqual(['security', 'tokenomics', 'l1l2', 'other']);
    expect(snap.byNiche[0]!.replies).toBe(1);
    expect(snap.byNiche[1]!.replies).toBe(0);
  });

  it('byKol is sorted by totalImp descending', () => {
    const replies = [
      reply({ post_id: 'a', kol_handle: '@low', impressions: 10 }),
      reply({ post_id: 'b', kol_handle: '@high', impressions: 500 }),
      reply({ post_id: 'c', kol_handle: '@high', impressions: 100 }),
    ];
    const snap = buildSnapshot([], replies, [], period, 'NOW');
    expect(snap.byKol[0]!.handle).toBe('@high');
    expect(snap.byKol[0]!.totalImp).toBe(600);
    expect(snap.byKol[0]!.replies).toBe(2);
    expect(snap.byKol[0]!.avgImp).toBe(300);
    expect(snap.byKol[1]!.handle).toBe('@low');
  });

  it('parentSizeCorrelation buckets by parent impressions', () => {
    const replies = [
      reply({ post_id: 'a', parent_impressions: 500, impressions: 10 }),
      reply({ post_id: 'b', parent_impressions: 5000, impressions: 30 }),
      reply({ post_id: 'c', parent_impressions: 50000, impressions: 90 }),
    ];
    const snap = buildSnapshot([], replies, [], period, 'NOW');
    const bands = Object.fromEntries(snap.parentSizeCorrelation.buckets.map((b) => [b.parentImpBand, b]));
    expect(bands['<1k']!.replies).toBe(1);
    expect(bands['1k-10k']!.replies).toBe(1);
    expect(bands['>10k']!.replies).toBe(1);
    expect(bands['>10k']!.avgReplyImp).toBe(90);
  });

  it('byHour groups enriched rows by hour', () => {
    const replies = [
      reply({ post_id: 'a', hour: 9, impressions: 100 }),
      reply({ post_id: 'b', hour: 9, impressions: 200 }),
      reply({ post_id: 'c', hour: null, impressions: 999 }), // excluded
    ];
    const snap = buildSnapshot([], replies, [], period, 'NOW');
    expect(snap.byHour).toEqual([{ hour: 9, replies: 2, avgImp: 150 }]);
  });

  it('weeklyTrend groups all rows by week', () => {
    const all = [
      reply({ post_id: 'a', posted_date: '2026-06-01', impressions: 100 }),
      reply({ post_id: 'b', posted_date: '2026-06-03', impressions: 200 }),
      reply({ post_id: 'c', posted_date: '2026-06-08', impressions: 300 }),
    ];
    const snap = buildSnapshot([], [], all, period, 'NOW');
    expect(snap.weeklyTrend).toEqual([
      { week: '2026-06-01', avgImpPerReply: 150 },
      { week: '2026-06-08', avgImpPerReply: 300 },
    ]);
  });
});

describe('enricher helpers', () => {
  it('computeHourPlus7 converts UTC to +07:00 hour', () => {
    expect(computeHourPlus7('2026-06-05T03:00:00.000Z')).toBe(10);
    expect(computeHourPlus7('2026-06-05T20:00:00.000Z')).toBe(3); // wraps next day
    expect(computeHourPlus7('not a date')).toBeNull();
    expect(computeHourPlus7(null)).toBeNull();
  });

  it('mapTweet extracts the fields we need', () => {
    const json = {
      id: '999',
      createdAt: '2026-06-05T03:00:00.000Z',
      author: { userName: 'samczsun' },
      inReplyToId: '888',
      viewCount: 5000,
      likeCount: 100,
      retweetCount: 10,
      replyCount: 5,
      quoteCount: 5,
    };
    const m = mapTweet(json);
    expect(m.id).toBe('999');
    expect(m.createdAt).toBe('2026-06-05T03:00:00.000Z');
    expect(m.authorHandle).toBe('@samczsun');
    expect(m.inReplyToId).toBe('888');
    expect(m.impressions).toBe(5000);
    expect(m.engagements).toBe(120); // 100+10+5+5
  });

  it('mapTweet tolerates missing metrics', () => {
    const m = mapTweet({ id: '1' });
    expect(m.impressions).toBeNull();
    expect(m.engagements).toBeNull();
    expect(m.authorHandle).toBeNull();
  });

  it('nextBackoffMs grows exponentially and honors Retry-After', () => {
    expect(nextBackoffMs(0)).toBe(500);
    expect(nextBackoffMs(1)).toBe(1000);
    expect(nextBackoffMs(2)).toBe(2000);
    expect(nextBackoffMs(10)).toBe(10_000); // capped
    expect(nextBackoffMs(0, 3)).toBe(3000); // Retry-After: 3s wins
  });
});

describe('createEnricher (throttle + retry)', () => {
  // A minimal mock Response.
  function res(status: number, body: unknown, retryAfter?: string): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: (k: string) => (k.toLowerCase() === 'retry-after' ? retryAfter ?? null : null) },
      json: async () => body,
    } as unknown as Response;
  }
  const tweet = (over: Record<string, unknown>) => ({ tweets: [over] });

  it('retries on 429 then succeeds, returning parent metrics', async () => {
    const calls: string[] = [];
    let replyHits = 0;
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.includes('reply1')) {
        replyHits += 1;
        if (replyHits === 1) return res(429, {}); // first attempt rate-limited
        return res(200, tweet({ id: 'reply1', createdAt: '2026-06-05T03:00:00.000Z', inReplyToId: 'parent1' }));
      }
      // parent
      return res(200, tweet({ id: 'parent1', author: { userName: 'samczsun' }, viewCount: 5000, likeCount: 100 }));
    }) as unknown as typeof fetch;

    const sleeps: number[] = [];
    const enrich = createEnricher({
      fetchImpl, apiKey: 'k', qps: 1000,
      sleep: async (ms) => { sleeps.push(ms); },
    });

    const out = await enrich('reply1');
    expect(replyHits).toBe(2); // one 429 retry
    expect(out.hour).toBe(10);
    expect(out.parentTweetId).toBe('parent1');
    expect(out.parentImpressions).toBe(5000);
    expect(out.parentEngagements).toBe(100);
    // a backoff sleep (500ms) happened on the 429
    expect(sleeps).toContain(500);
  });

  it('throttles by sleeping to respect the configured QPS', async () => {
    const fetchImpl = (async () =>
      res(200, tweet({ id: 'x', createdAt: '2026-06-05T03:00:00.000Z' }))) as unknown as typeof fetch;
    const sleeps: number[] = [];
    const enrich = createEnricher({
      fetchImpl, apiKey: 'k', qps: 10, // 100ms min interval
      now: () => 0, // frozen clock → every acquire must wait the full interval
      sleep: async (ms) => { sleeps.push(ms); },
    });
    await enrich('only'); // no parent (no inReplyToId) → 1 fetch
    expect(sleeps).toContain(100); // throttle waited 1000/qps ms
  });
});

describe('runReplyAnalyze orchestrator', () => {
  let db: Database.Database;
  let dir: string;
  beforeEach(() => {
    db = createTestDb();
    dir = mkdtempSync(join(tmpdir(), 'inkpilot-reply-'));
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  function writeContent(): string {
    const csv = [
      'Post id,Date,Post text,Post Link,Impressions,Engagements,New follows',
      '111,"Fri, Jun 5, 2026","@samczsun nice point",https://x.com/u/status/111,71,2,1',
      '222,"Fri, Jun 5, 2026","just a normal original post",https://x.com/u/status/222,500,15,4',
      '333,"Fri, Jun 5, 2026","@some_rando small",https://x.com/u/status/333,40,0,0',
    ].join('\n') + '\n';
    const p = join(dir, 'content.csv');
    writeFileSync(p, csv);
    return p;
  }
  function writeOverview(): string {
    const csv = [
      'Date,Impressions,New follows,Unfollows',
      '"Fri, Jun 5, 2026",941,12,0',
      '"Mon, Jun 1, 2026",781,6,4',
    ].join('\n') + '\n';
    const p = join(dir, 'overview.csv');
    writeFileSync(p, csv);
    return p;
  }

  it('parses, stores replies (not originals), enriches, and is idempotent', async () => {
    const contentPath = writeContent();
    const overviewPath = writeOverview();
    const stubEnrich = async (postId: string) => ({
      replyCreatedAt: '2026-06-05T03:00:00.000Z', hour: 10,
      parentTweetId: 'p' + postId, parentImpressions: 5000, parentEngagements: 100,
      parentAuthorHandle: '@samczsun',
    });

    const res1 = await runReplyAnalyze({ contentPath, overviewPath, enrichFn: stubEnrich, exportFn: () => 'X', db });
    expect(res1.snapshot.summary.replyCount).toBe(2);   // 111 + 333
    expect(res1.snapshot.summary.originalCount).toBe(1); // 222
    expect(res1.snapshot.summary.dudRate).toBe(0.5);     // 333 is a dud
    expect(getAllReplies(db)).toHaveLength(2);
    expect(res1.enriched).toBe(2);

    // re-run same CSV: no duplicates, no re-enrichment
    const res2 = await runReplyAnalyze({ contentPath, overviewPath, enrichFn: stubEnrich, exportFn: () => 'X', db });
    expect(getAllReplies(db)).toHaveLength(2);
    expect(res2.enriched).toBe(0);
    // niche lookup applied
    const security = res2.snapshot.byNiche.find((n) => n.niche === 'security')!;
    expect(security.replies).toBe(1); // @samczsun
  });

  it('does not crash when enrichment of one reply throws', async () => {
    const contentPath = writeContent();
    const overviewPath = writeOverview();
    const flaky = async (postId: string) => {
      if (postId === '333') throw new Error('boom');
      return {
        replyCreatedAt: '2026-06-05T03:00:00.000Z', hour: 10, parentTweetId: 'p',
        parentImpressions: 5000, parentEngagements: 100, parentAuthorHandle: '@x',
      };
    };
    const res = await runReplyAnalyze({ contentPath, overviewPath, enrichFn: flaky, exportFn: () => 'X', db });
    expect(res.enriched).toBe(1);
    expect(res.enrichFailed).toBe(1);
    expect(getAllReplies(db)).toHaveLength(2);
  });

  it('throws a clear error when the content CSV is missing', async () => {
    await expect(
      runReplyAnalyze({ contentPath: join(dir, 'nope.csv'), overviewPath: join(dir, 'nope2.csv'), enrichFn: async () => ({
        replyCreatedAt: null, hour: null, parentTweetId: null,
        parentImpressions: null, parentEngagements: null, parentAuthorHandle: null,
      }), exportFn: () => 'X', db }),
    ).rejects.toThrow(/Content CSV not found/);
  });

  it('degrades gracefully when the overview CSV is missing (period from content)', async () => {
    const contentPath = writeContent();
    const stubEnrich = async () => ({
      replyCreatedAt: null, hour: null, parentTweetId: null,
      parentImpressions: null, parentEngagements: null, parentAuthorHandle: null,
    });
    const res = await runReplyAnalyze({ contentPath, overviewPath: join(dir, 'missing-overview.csv'), enrichFn: stubEnrich, exportFn: () => 'X', db });
    expect(res.snapshot.period.end).toBe('2026-06-05');   // max content date
    expect(res.snapshot.period.start).toBe('2026-05-30'); // 7-day window: Jun 5 - 6 days
    expect(res.snapshot.summary.replyCount).toBe(2);
  });

  it('only enriches and scopes summary to the latest week, keeps older replies in DB', async () => {
    // content spans two weeks; latest week = Jun 8-14
    const csv = [
      'Post id,Date,Post text,Post Link,Impressions,Engagements,New follows',
      '900,"Mon, May 18, 2026","@samczsun old week reply",,200,2,3', // OLD week
      '901,"Mon, Jun 8, 2026","@samczsun new week reply",,100,2,1',  // latest week
      '902,"Wed, Jun 10, 2026","@DefiIgnas new week reply",,80,1,0', // latest week
      '903,"Sun, Jun 14, 2026","just an original",,500,9,4',          // latest week original
    ].join('\n') + '\n';
    const contentPath = join(dir, 'content.csv');
    writeFileSync(contentPath, csv);

    const enriched: string[] = [];
    const stubEnrich = async (postId: string) => {
      enriched.push(postId);
      return {
        replyCreatedAt: '2026-06-10T02:00:00.000Z', hour: 9, parentTweetId: 'p' + postId,
        parentImpressions: 5000, parentEngagements: 100, parentAuthorHandle: '@x',
      };
    };

    const res = await runReplyAnalyze({ contentPath, overviewPath: join(dir, 'none.csv'), enrichFn: stubEnrich, exportFn: () => 'X', db });

    // all 3 replies stored (old + 2 new) so weeklyTrend keeps history
    expect(getAllReplies(db)).toHaveLength(3);
    // but only the latest-week replies were enriched
    expect(enriched.sort()).toEqual(['901', '902']);
    expect(res.enriched).toBe(2);
    // summary scoped to latest week: 2 replies, 1 original — NOT 3 replies
    expect(res.snapshot.summary.replyCount).toBe(2);
    expect(res.snapshot.summary.originalCount).toBe(1);
    // summary reconciles with byNiche totals
    const byNicheReplies = res.snapshot.byNiche.reduce((s, n) => s + n.replies, 0);
    expect(res.snapshot.summary.replyCount).toBe(byNicheReplies);
    // weeklyTrend spans both weeks (all rows)
    expect(res.snapshot.weeklyTrend.length).toBeGreaterThanOrEqual(2);
  });
});

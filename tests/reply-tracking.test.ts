import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  upsertReply,
  updateReplyEnrichment,
  getRepliesNeedingEnrichment,
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

  it('derivePeriod returns min/max and a label', () => {
    const p = derivePeriod(['2026-06-07', '2026-06-01', '2026-06-05']);
    expect(p.start).toBe('2026-06-01');
    expect(p.end).toBe('2026-06-07');
    expect(p.label).toBe('Jun 1 – Jun 7, 2026');
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

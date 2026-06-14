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

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
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

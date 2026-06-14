# Reply Tracking (v0.5.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `reply:analyze` command that reads X Analytics CSVs, classifies which posts are KOL replies, enriches each reply with parent-tweet metrics via TwitterAPI.io, accumulates history in a new `reply_tracking` SQLite table, and writes a fixed-schema JSON snapshot to the vault for the Newsroom dashboard.

**Architecture:** CSV is the free base layer (reply impressions/engagements/follows). TwitterAPI.io is called only to fill what CSV lacks: reply timestamp (→ hour-of-day) and the parent tweet's cumulative impressions/engagements (a proxy for "how hot the wave was"). All aggregation happens by querying the DB after upsert, so re-runs are idempotent and the snapshot is reproducible. `weeklyTrend` spans all accumulated rows; every other section reflects the current CSV's period.

**Tech Stack:** TypeScript (ESM, `.js` import suffix), `better-sqlite3` (synchronous), `tsx` runner, `vitest` (in-memory SQLite), native `fetch` for TwitterAPI.io. No new npm dependencies — CSV is parsed by a small hand-written RFC-4180 parser.

---

## File Structure

**New files:**
- `src/config/kol-niches.ts` — KOL handle → niche config (source of truth, synced by hand from the vault `kol-reply-list.md`) + `lookupNiche()`.
- `src/reply-tracking/types.ts` — shared types (`ContentRow`, `OverviewRow`, `Period`, `ReplyEnrichment`, `ReplySnapshot`, etc.).
- `src/reply-tracking/csv-parser.ts` — `parseCsv`, `parseContentCsv`, `parseOverviewCsv`, `parseXDate`, `extractKolHandle`, `derivePeriod`.
- `src/reply-tracking/enricher.ts` — TwitterAPI.io client: `enrichReply` (`EnrichFn`) + pure helpers `mapTweet`, `computeHourPlus7`.
- `src/reply-tracking/snapshot-builder.ts` — `buildSnapshot` (pure) + `nowIsoPlus7`, `weekStart`.
- `src/reply-tracking/exporter.ts` — `exportSnapshot` (writes `latest.json` to vault).
- `src/reply-tracking/index.ts` — `runReplyAnalyze` orchestrator.
- `src/database/reply-tracking.ts` — `upsertReply`, `updateReplyEnrichment`, `getRepliesNeedingEnrichment`, `getRepliesInPeriod`, `getAllReplies`.
- `src/scripts/reply-analyze.ts` — CLI entry.
- `tests/reply-tracking.test.ts` — unit tests for all pure logic + DB idempotency.

**Modified files:**
- `src/database/schema.ts` — add `reply_tracking` table + indexes.
- `src/config/index.ts` — add `REPLY_THRESHOLDS` + `requireTwitterApiIoKey()`.
- `package.json` — add `reply:analyze` script + bump version.
- `.env.example` — add `TWITTERAPI_IO_KEY`.
- `tests/database.test.ts` — update table-count assertion 7 → 8.
- `CLAUDE.md`, `CHANGELOG.md` — release docs.

---

## Decisions locked from the spec

- **Niche enum:** `security | tokenomics | l1l2 | other`. Unknown handle → `other`.
- **Reply detection:** `Post text` (after trimStart) begins with `@`. KOL handle = `@` + chars matching `\w+` immediately after the first `@`.
- **Dud:** reply with `Impressions < 50` (`REPLY_THRESHOLDS.DUD_IMPRESSIONS = 50`).
- **Idempotency key:** `post_id` (reply tweet id). Re-running the same CSV updates metrics, never duplicates rows. The `ON CONFLICT` clause deliberately does **not** overwrite enrichment columns, so a re-run preserves prior enrichment.
- **Enrichment is one-pass:** only rows with `enriched_at IS NULL` call the API (saves reads, keeps re-runs cheap). A per-reply API failure logs a warning and skips that reply — the run continues.
- **`weeklyTrend`** is computed from **all** rows in the DB grouped by ISO week (Monday start); all other sections use the current period only.
- **Provider:** TwitterAPI.io, key `TWITTERAPI_IO_KEY` in `.env`. ~2 reads/reply, cost negligible — no batching/optimization required.
- **Do not touch** `posts` / `post_metrics`; do not build a posting adapter.

---

## Task 1: `reply_tracking` table + schema

**Files:**
- Modify: `src/database/schema.ts` (append before the closing backtick of `CREATE_TABLES`)
- Modify: `tests/database.test.ts:27-44` (the "creates all 7 tables" test)

- [ ] **Step 1: Update the table-count test to expect 8 tables**

In `tests/database.test.ts`, replace the `it('creates all 7 tables', ...)` body so it expects `reply_tracking`:

```ts
  it('creates all 8 tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>;

    const tableNames = tables.map((t) => t.name).sort();

    expect(tableNames).toEqual([
      'article_states',
      'articles',
      'drafts',
      'filter_results',
      'post_metrics',
      'posts',
      'reply_tracking',
      'sources',
    ]);
    expect(tables).toHaveLength(8);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/database.test.ts -t "creates all 8 tables"`
Expected: FAIL — array has 7 entries, `reply_tracking` missing.

- [ ] **Step 3: Add the table to the schema**

In `src/database/schema.ts`, insert this block immediately after the `post_metrics` table definition (before the `CREATE INDEX` lines):

```sql
CREATE TABLE IF NOT EXISTS reply_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL UNIQUE,
  post_url TEXT,
  posted_date TEXT NOT NULL,
  post_text TEXT,
  kol_handle TEXT,
  niche TEXT NOT NULL DEFAULT 'other' CHECK(niche IN ('security','tokenomics','l1l2','other')),
  impressions INTEGER NOT NULL DEFAULT 0,
  engagements INTEGER NOT NULL DEFAULT 0,
  new_follows INTEGER NOT NULL DEFAULT 0,
  parent_tweet_id TEXT,
  parent_impressions INTEGER,
  parent_engagements INTEGER,
  reply_created_at TEXT,
  hour INTEGER,
  enriched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

And add these two index lines alongside the existing `CREATE INDEX` block:

```sql
CREATE INDEX IF NOT EXISTS idx_reply_tracking_posted_date ON reply_tracking(posted_date);
CREATE INDEX IF NOT EXISTS idx_reply_tracking_kol ON reply_tracking(kol_handle);
```

> Note: `CREATE TABLE IF NOT EXISTS` in `runMigrations` handles creation on existing DBs automatically — no bespoke migration function needed (the table is new, no ALTER required).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/database.test.ts -t "creates all 8 tables"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/database/schema.ts tests/database.test.ts
git commit -m "feat(db): add reply_tracking table"
```

---

## Task 2: KOL → niche config

**Files:**
- Create: `src/config/kol-niches.ts`
- Test: `tests/reply-tracking.test.ts` (create the file in this task)

- [ ] **Step 1: Write the failing test**

Create `tests/reply-tracking.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/database/migrations.js';
import { lookupNiche, NICHES } from '../src/config/kol-niches.js';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/reply-tracking.test.ts -t "kol-niches"`
Expected: FAIL — `Cannot find module '../src/config/kol-niches.js'`.

- [ ] **Step 3: Create the config**

Create `src/config/kol-niches.ts`:

```ts
export type Niche = 'security' | 'tokenomics' | 'l1l2' | 'other';

/** Fixed enum order — also the canonical order used in snapshot `byNiche`. */
export const NICHES: readonly Niche[] = ['security', 'tokenomics', 'l1l2', 'other'] as const;

export interface KolNicheConfig {
  /** X handle WITHOUT leading @, stored lowercase. */
  handle: string;
  niche: Niche;
}

// Synced BY HAND from ~/Dev/vault/projects/inkpilot/decisions/kol-reply-list.md.
// Re-edit this list when the vault list changes — there is no auto-parse.
export const KOL_NICHES: KolNicheConfig[] = [
  // Security
  { handle: 'samczsun', niche: 'security' },
  { handle: 'tayvano_', niche: 'security' },
  { handle: 'peckshieldalert', niche: 'security' },
  { handle: 'peckshield', niche: 'security' },
  { handle: 'slowmist', niche: 'security' },
  { handle: 'officer_cia', niche: 'security' },
  { handle: 'zachxbt', niche: 'security' },
  // Tokenomics / DeFi
  { handle: 'defiignas', niche: 'tokenomics' },
  { handle: 'stanikulechov', niche: 'tokenomics' },
  { handle: 'bantg', niche: 'tokenomics' },
  // L1/L2 infra
  { handle: '0xmert_', niche: 'l1l2' },
  { handle: 'aeyakovenko', niche: 'l1l2' },
  // Commentary / community → other
  { handle: 'cryptoteluguo', niche: 'other' },
  { handle: 'cobie', niche: 'other' },
  { handle: '5phutcrypto_', niche: 'other' },
  { handle: 'bachkhoabnb', niche: 'other' },
  { handle: 'thangonton', niche: 'other' },
  { handle: 'chanhdoro', niche: 'other' },
  { handle: 'trimaims', niche: 'other' },
  { handle: 'solotop999', niche: 'other' },
];

const NICHE_MAP = new Map<string, Niche>(
  KOL_NICHES.map((k) => [k.handle.toLowerCase(), k.niche]),
);

/** Look up a niche for a handle (with or without leading @, any case). Unknown → 'other'. */
export function lookupNiche(handle: string): Niche {
  const norm = handle.replace(/^@/, '').toLowerCase();
  return NICHE_MAP.get(norm) ?? 'other';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/reply-tracking.test.ts -t "kol-niches"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/kol-niches.ts tests/reply-tracking.test.ts
git commit -m "feat(config): add KOL→niche map and lookupNiche"
```

---

## Task 3: Shared types

**Files:**
- Create: `src/reply-tracking/types.ts`

> No test of its own — types are exercised by later tasks. This task just locks the shapes so every later task references identical names.

- [ ] **Step 1: Create the types file**

Create `src/reply-tracking/types.ts`:

```ts
import type { Niche } from '../config/kol-niches.js';

/** One row from content-latest.csv, normalized. */
export interface ContentRow {
  postId: string;
  rawDate: string;
  postedDate: string; // YYYY-MM-DD
  postText: string;
  postLink: string;
  impressions: number;
  engagements: number;
  newFollows: number;
  isReply: boolean;
  kolHandle: string | null; // '@handle' as it appears, or null for originals
}

/** One row from overview-latest.csv, normalized. */
export interface OverviewRow {
  rawDate: string;
  date: string; // YYYY-MM-DD
  impressions: number;
  newFollows: number;
  unfollows: number;
}

export interface Period {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  label: string; // e.g. "Jun 1 – Jun 7, 2026"
}

/** Result of enriching one reply via TwitterAPI.io. Any field may be null on partial data. */
export interface ReplyEnrichment {
  replyCreatedAt: string | null;
  hour: number | null; // 0-23 in +07:00
  parentTweetId: string | null;
  parentImpressions: number | null;
  parentEngagements: number | null;
  parentAuthorHandle: string | null;
}

export type EnrichFn = (postId: string) => Promise<ReplyEnrichment>;

// ---- Snapshot (the Newsroom output contract) ----

export interface SnapshotSummary {
  replyCount: number;
  originalCount: number;
  replyImpShare: number;
  avgImpPerReply: number;
  avgImpPerOriginal: number;
  dudRate: number;
  newFollowsFromReply: number;
  newFollowsFromOriginal: number;
}

export interface SnapshotKol {
  handle: string;
  niche: Niche;
  replies: number;
  avgImp: number;
  totalImp: number;
  follows: number;
}

export interface SnapshotNiche {
  niche: Niche;
  replies: number;
  totalImp: number;
  avgImp: number;
}

export interface SnapshotHour {
  hour: number;
  replies: number;
  avgImp: number;
}

export interface SnapshotParentBucket {
  parentImpBand: '<1k' | '1k-10k' | '>10k';
  replies: number;
  avgReplyImp: number;
}

export interface SnapshotWeek {
  week: string; // YYYY-MM-DD (Monday)
  avgImpPerReply: number;
}

export interface ReplySnapshot {
  generatedAt: string;
  period: Period;
  summary: SnapshotSummary;
  byKol: SnapshotKol[];
  byNiche: SnapshotNiche[];
  byHour: SnapshotHour[];
  parentSizeCorrelation: {
    note: string;
    buckets: SnapshotParentBucket[];
  };
  weeklyTrend: SnapshotWeek[];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add src/reply-tracking/types.ts
git commit -m "feat(reply-tracking): add shared types"
```

---

## Task 4: CSV parser

**Files:**
- Create: `src/reply-tracking/csv-parser.ts`
- Test: `tests/reply-tracking.test.ts` (append a `describe`)

- [ ] **Step 1: Write failing tests**

Append to `tests/reply-tracking.test.ts` (add the import at the top alongside the existing ones):

```ts
import {
  parseCsv,
  parseXDate,
  extractKolHandle,
  derivePeriod,
} from '../src/reply-tracking/csv-parser.js';
```

```ts
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/reply-tracking.test.ts -t "csv-parser"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `src/reply-tracking/csv-parser.ts`:

```ts
import { readFileSync } from 'node:fs';
import type { ContentRow, OverviewRow, Period } from './types.js';
import { extractKolHandle as _extract } from './csv-parser.js'; // self-ref removed below

const MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};
const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** RFC-4180-ish CSV parse: handles quoted fields, embedded commas/quotes/newlines. */
export function parseCsv(input: string): string[][] {
  let text = input;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** "Sun, Jun 7, 2026" → "2026-06-07". */
export function parseXDate(raw: string): string {
  const m = raw.match(/([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) throw new Error(`Unrecognized X date format: "${raw}"`);
  const mon = MONTHS[m[1]!];
  if (!mon) throw new Error(`Unknown month in date: "${raw}"`);
  return `${m[3]}-${mon}-${m[2]!.padStart(2, '0')}`;
}

/** Reply detection: text (trimmed) starts with '@'; handle = '@' + \w+ after it. */
export function extractKolHandle(postText: string): string | null {
  const t = postText.trimStart();
  if (!t.startsWith('@')) return null;
  const m = t.match(/^@(\w+)/);
  return m ? `@${m[1]}` : null;
}

function indexHeaders(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => { idx[h.trim().toLowerCase()] = i; });
  return idx;
}

function num(v: string | undefined): number {
  const n = parseInt((v ?? '').replace(/[^0-9-]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

export function parseContentCsv(filePath: string): ContentRow[] {
  const rows = parseCsv(readFileSync(filePath, 'utf-8'));
  if (rows.length === 0) return [];
  const idx = indexHeaders(rows[0]!);
  const get = (r: string[], key: string): string | undefined => {
    const k = idx[key];
    return k === undefined ? undefined : r[k];
  };
  const out: ContentRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const postId = (get(r, 'post id') ?? '').trim();
    if (!postId) continue;
    const rawDate = get(r, 'date') ?? '';
    const postText = get(r, 'post text') ?? '';
    const handle = extractKolHandle(postText);
    out.push({
      postId,
      rawDate,
      postedDate: parseXDate(rawDate),
      postText,
      postLink: get(r, 'post link') ?? '',
      impressions: num(get(r, 'impressions')),
      engagements: num(get(r, 'engagements')),
      newFollows: num(get(r, 'new follows')),
      isReply: handle !== null,
      kolHandle: handle,
    });
  }
  return out;
}

export function parseOverviewCsv(filePath: string): OverviewRow[] {
  const rows = parseCsv(readFileSync(filePath, 'utf-8'));
  if (rows.length === 0) return [];
  const idx = indexHeaders(rows[0]!);
  const get = (r: string[], key: string): string | undefined => {
    const k = idx[key];
    return k === undefined ? undefined : r[k];
  };
  const out: OverviewRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    const rawDate = get(r, 'date') ?? '';
    if (!rawDate) continue;
    out.push({
      rawDate,
      date: parseXDate(rawDate),
      impressions: num(get(r, 'impressions')),
      newFollows: num(get(r, 'new follows')),
      unfollows: num(get(r, 'unfollows')),
    });
  }
  return out;
}

function formatLabel(start: string, end: string): string {
  const [, sm, sd] = start.split('-').map((x) => parseInt(x, 10)) as [number, number, number];
  const [ey, em, ed] = end.split('-').map((x) => parseInt(x, 10)) as [number, number, number];
  return `${MONTH_ABBR[sm - 1]} ${sd} – ${MONTH_ABBR[em - 1]} ${ed}, ${ey}`;
}

export function derivePeriod(dates: string[]): Period {
  const sorted = dates.filter(Boolean).slice().sort();
  if (sorted.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return { start: today, end: today, label: formatLabel(today, today) };
  }
  const start = sorted[0]!;
  const end = sorted[sorted.length - 1]!;
  return { start, end, label: formatLabel(start, end) };
}
```

> **Remove the bogus self-import line** at the top (`import { extractKolHandle as _extract } from './csv-parser.js';`) — it was a copy artifact. The file defines `extractKolHandle` itself; it must not import from itself.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/reply-tracking.test.ts -t "csv-parser"`
Expected: PASS.

- [ ] **Step 5: Sanity-check against the real CSV**

Run: `npx tsx -e "import('./src/reply-tracking/csv-parser.js').then(m => { const rows = m.parseContentCsv(process.env.HOME + '/Dev/vault/projects/content-creator/analytics/raw/content-latest.csv'); console.log('rows', rows.length, 'replies', rows.filter(r=>r.isReply).length); console.log(rows.find(r=>r.isReply)); })"`
Expected: prints a row count, a non-zero reply count, and a sample reply with `kolHandle` like `@5phutcrypto_`.

- [ ] **Step 6: Commit**

```bash
git add src/reply-tracking/csv-parser.ts tests/reply-tracking.test.ts
git commit -m "feat(reply-tracking): CSV parser, date parsing, reply detection"
```

---

## Task 5: DB access for reply_tracking

**Files:**
- Create: `src/database/reply-tracking.ts`
- Test: `tests/reply-tracking.test.ts` (append a `describe`)

- [ ] **Step 1: Write failing tests**

Append the import:

```ts
import {
  upsertReply,
  updateReplyEnrichment,
  getRepliesNeedingEnrichment,
  getRepliesInPeriod,
  getAllReplies,
} from '../src/database/reply-tracking.js';
import type { InsertReply } from '../src/database/reply-tracking.js';
```

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/reply-tracking.test.ts -t "reply-tracking db"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the DB module**

Create `src/database/reply-tracking.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/reply-tracking.test.ts -t "reply-tracking db"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/database/reply-tracking.ts tests/reply-tracking.test.ts
git commit -m "feat(db): reply_tracking access layer with idempotent upsert"
```

---

## Task 6: Snapshot builder (pure)

**Files:**
- Modify: `src/config/index.ts` (add `REPLY_THRESHOLDS`)
- Create: `src/reply-tracking/snapshot-builder.ts`
- Test: `tests/reply-tracking.test.ts` (append a `describe`)

- [ ] **Step 1: Add the threshold constant**

In `src/config/index.ts`, after the `SCORE_THRESHOLDS` block, add:

```ts
export const REPLY_THRESHOLDS = {
  DUD_IMPRESSIONS: 50, // reply with impressions < this is a "dud"
} as const;
```

- [ ] **Step 2: Write failing tests**

Append imports:

```ts
import { buildSnapshot, weekStart, nowIsoPlus7 } from '../src/reply-tracking/snapshot-builder.js';
import type { ContentRow } from '../src/reply-tracking/types.js';
import type { ReplyRow } from '../src/database/reply-tracking.js';
```

```ts
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
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/reply-tracking.test.ts -t "snapshot"`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the builder**

Create `src/reply-tracking/snapshot-builder.ts`:

```ts
import { REPLY_THRESHOLDS } from '../config/index.js';
import { NICHES, type Niche } from '../config/kol-niches.js';
import type { ReplyRow } from '../database/reply-tracking.js';
import type {
  ContentRow, Period, ReplySnapshot, SnapshotKol, SnapshotNiche,
  SnapshotHour, SnapshotParentBucket, SnapshotWeek,
} from './types.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function avgInt(total: number, count: number): number {
  return count === 0 ? 0 : Math.round(total / count);
}

/** Monday (UTC) of the ISO week containing dateStr (YYYY-MM-DD). */
export function weekStart(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const daysSinceMonday = (dow + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d.toISOString().slice(0, 10);
}

/** Current instant shifted to +07:00 wall clock, labeled with a +07:00 offset. */
export function nowIsoPlus7(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 7 * 3_600_000);
  return shifted.toISOString().replace('Z', '+07:00');
}

function parentBand(imp: number): SnapshotParentBucket['parentImpBand'] {
  if (imp < 1000) return '<1k';
  if (imp <= 10_000) return '1k-10k';
  return '>10k';
}

export function buildSnapshot(
  contentRows: ContentRow[],
  periodReplies: ReplyRow[],
  allReplies: ReplyRow[],
  period: Period,
  generatedAt: string,
): ReplySnapshot {
  // --- summary (from content CSV) ---
  const replies = contentRows.filter((r) => r.isReply);
  const originals = contentRows.filter((r) => !r.isReply);
  const sumReplyImp = replies.reduce((s, r) => s + r.impressions, 0);
  const sumOrigImp = originals.reduce((s, r) => s + r.impressions, 0);
  const totalImp = sumReplyImp + sumOrigImp;
  const duds = replies.filter((r) => r.impressions < REPLY_THRESHOLDS.DUD_IMPRESSIONS).length;

  const summary = {
    replyCount: replies.length,
    originalCount: originals.length,
    replyImpShare: totalImp === 0 ? 0 : round2(sumReplyImp / totalImp),
    avgImpPerReply: avgInt(sumReplyImp, replies.length),
    avgImpPerOriginal: avgInt(sumOrigImp, originals.length),
    dudRate: replies.length === 0 ? 0 : round2(duds / replies.length),
    newFollowsFromReply: replies.reduce((s, r) => s + r.newFollows, 0),
    newFollowsFromOriginal: originals.reduce((s, r) => s + r.newFollows, 0),
  };

  // --- byKol (period replies, sorted by totalImp desc) ---
  const kolMap = new Map<string, { niche: Niche; replies: number; totalImp: number; follows: number }>();
  for (const r of periodReplies) {
    const handle = r.kol_handle ?? '@unknown';
    const entry = kolMap.get(handle) ?? { niche: r.niche, replies: 0, totalImp: 0, follows: 0 };
    entry.replies += 1;
    entry.totalImp += r.impressions;
    entry.follows += r.new_follows;
    kolMap.set(handle, entry);
  }
  const byKol: SnapshotKol[] = [...kolMap.entries()]
    .map(([handle, e]) => ({
      handle, niche: e.niche, replies: e.replies,
      avgImp: avgInt(e.totalImp, e.replies), totalImp: e.totalImp, follows: e.follows,
    }))
    .sort((a, b) => b.totalImp - a.totalImp);

  // --- byNiche (always all 4) ---
  const byNiche: SnapshotNiche[] = NICHES.map((niche) => {
    const rs = periodReplies.filter((r) => r.niche === niche);
    const tot = rs.reduce((s, r) => s + r.impressions, 0);
    return { niche, replies: rs.length, totalImp: tot, avgImp: avgInt(tot, rs.length) };
  });

  // --- byHour (period replies with known hour) ---
  const hourMap = new Map<number, { replies: number; totalImp: number }>();
  for (const r of periodReplies) {
    if (r.hour === null) continue;
    const e = hourMap.get(r.hour) ?? { replies: 0, totalImp: 0 };
    e.replies += 1;
    e.totalImp += r.impressions;
    hourMap.set(r.hour, e);
  }
  const byHour: SnapshotHour[] = [...hourMap.entries()]
    .map(([hour, e]) => ({ hour, replies: e.replies, avgImp: avgInt(e.totalImp, e.replies) }))
    .sort((a, b) => a.hour - b.hour);

  // --- parentSizeCorrelation (period replies with known parent imp) ---
  const bandOrder: SnapshotParentBucket['parentImpBand'][] = ['<1k', '1k-10k', '>10k'];
  const bandMap = new Map<string, { replies: number; totalImp: number }>();
  for (const r of periodReplies) {
    if (r.parent_impressions === null) continue;
    const band = parentBand(r.parent_impressions);
    const e = bandMap.get(band) ?? { replies: 0, totalImp: 0 };
    e.replies += 1;
    e.totalImp += r.impressions;
    bandMap.set(band, e);
  }
  const buckets: SnapshotParentBucket[] = bandOrder.map((band) => {
    const e = bandMap.get(band) ?? { replies: 0, totalImp: 0 };
    return { parentImpBand: band, replies: e.replies, avgReplyImp: avgInt(e.totalImp, e.replies) };
  });

  // --- weeklyTrend (ALL rows, grouped by week) ---
  const weekMap = new Map<string, { replies: number; totalImp: number }>();
  for (const r of allReplies) {
    const wk = weekStart(r.posted_date);
    const e = weekMap.get(wk) ?? { replies: 0, totalImp: 0 };
    e.replies += 1;
    e.totalImp += r.impressions;
    weekMap.set(wk, e);
  }
  const weeklyTrend: SnapshotWeek[] = [...weekMap.entries()]
    .map(([week, e]) => ({ week, avgImpPerReply: avgInt(e.totalImp, e.replies) }))
    .sort((a, b) => a.week.localeCompare(b.week));

  return {
    generatedAt,
    period,
    summary,
    byKol,
    byNiche,
    byHour,
    parentSizeCorrelation: {
      note: 'Parent impressions are the parent tweet\'s cumulative count at enrichment time, not at reply time — a proxy for wave size, not a realtime signal.',
      buckets,
    },
    weeklyTrend,
  };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/reply-tracking.test.ts -t "snapshot"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/index.ts src/reply-tracking/snapshot-builder.ts tests/reply-tracking.test.ts
git commit -m "feat(reply-tracking): pure snapshot builder + REPLY_THRESHOLDS"
```

---

## Task 7: TwitterAPI.io enricher

**Files:**
- Modify: `src/config/index.ts` (add `requireTwitterApiIoKey`)
- Create: `src/reply-tracking/enricher.ts`
- Test: `tests/reply-tracking.test.ts` (append a `describe` for the pure helpers only)

> **Live-API caveat:** TwitterAPI.io's exact JSON field names must be confirmed against their docs at https://docs.twitterapi.io before relying on real data. To keep that risk contained, all field access lives in the pure `mapTweet` function, which is unit-tested with a fixture. No real HTTP is made in tests (per CLAUDE.md). If the live shape differs, fix only `mapTweet` + the endpoint URLs.

- [ ] **Step 1: Add the key helper**

In `src/config/index.ts`, after `requireEnv`/`optionalEnv`, add (exported):

```ts
export function requireTwitterApiIoKey(): string {
  const key = process.env['TWITTERAPI_IO_KEY'];
  if (!key) {
    throw new Error(
      'Missing required env var: TWITTERAPI_IO_KEY. Add it to .env (see .env.example). ' +
        'Get a key at https://twitterapi.io. Or pass --skip-enrich to run CSV-only.',
    );
  }
  return key;
}
```

- [ ] **Step 2: Write failing tests for the pure helpers**

Append imports:

```ts
import { mapTweet, computeHourPlus7 } from '../src/reply-tracking/enricher.js';
```

```ts
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
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/reply-tracking.test.ts -t "enricher helpers"`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the enricher**

Create `src/reply-tracking/enricher.ts`:

```ts
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
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/reply-tracking.test.ts -t "enricher helpers"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/config/index.ts src/reply-tracking/enricher.ts tests/reply-tracking.test.ts
git commit -m "feat(reply-tracking): TwitterAPI.io enricher + key guard"
```

---

## Task 8: Exporter

**Files:**
- Create: `src/reply-tracking/exporter.ts`

> No unit test — it's filesystem I/O modeled exactly on `angle-exporter.ts`. It is exercised end-to-end in Task 9's smoke run.

- [ ] **Step 1: Implement the exporter**

Create `src/reply-tracking/exporter.ts`:

```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ReplySnapshot } from './types.js';

const OUTPUT_DIR = join(
  homedir(),
  'Dev/vault/projects/content-creator/analytics/reply-tracking',
);

/** Writes the fixed-schema snapshot to <vault>/.../reply-tracking/latest.json. */
export function exportSnapshot(snapshot: ReplySnapshot): string {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, 'latest.json');
  writeFileSync(outputPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
  return outputPath;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/reply-tracking/exporter.ts
git commit -m "feat(reply-tracking): vault snapshot exporter"
```

---

## Task 9: Orchestrator + CLI

**Files:**
- Create: `src/reply-tracking/index.ts`
- Create: `src/scripts/reply-analyze.ts`
- Modify: `package.json` (add script)
- Modify: `.env.example` (add key)
- Test: `tests/reply-tracking.test.ts` (append an orchestrator `describe` with injected stub enrich)

- [ ] **Step 1: Write a failing orchestrator test**

Append imports:

```ts
import { writeFileSync as _writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as _join } from 'node:path';
import { runReplyAnalyze } from '../src/reply-tracking/index.js';
```

```ts
describe('runReplyAnalyze orchestrator', () => {
  let db: Database.Database;
  let dir: string;
  beforeEach(() => {
    db = createTestDb();
    dir = mkdtempSync(_join(tmpdir(), 'inkpilot-reply-'));
  });

  function writeContent(): string {
    const csv = [
      'Post id,Date,Post text,Post Link,Impressions,Engagements,New follows',
      '111,"Fri, Jun 5, 2026","@samczsun nice point",https://x.com/u/status/111,71,2,1',
      '222,"Fri, Jun 5, 2026","just a normal original post",https://x.com/u/status/222,500,15,4',
      '333,"Fri, Jun 5, 2026","@some_rando small",https://x.com/u/status/333,40,0,0',
    ].join('\n') + '\n';
    const p = _join(dir, 'content.csv');
    _writeFileSync(p, csv);
    return p;
  }
  function writeOverview(): string {
    const csv = [
      'Date,Impressions,New follows,Unfollows',
      '"Fri, Jun 5, 2026",941,12,0',
      '"Mon, Jun 1, 2026",781,6,4',
    ].join('\n') + '\n';
    const p = _join(dir, 'overview.csv');
    _writeFileSync(p, csv);
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

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
});
```

> Add `afterEach` to the vitest import at the top of the file if not present: `import { describe, it, expect, beforeEach, afterEach } from 'vitest';`

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/reply-tracking.test.ts -t "orchestrator"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

Create `src/reply-tracking/index.ts`:

```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { lookupNiche } from '../config/kol-niches.js';
import { createLogger } from '../utils/logger.js';
import {
  parseContentCsv, parseOverviewCsv, derivePeriod,
} from './csv-parser.js';
import { buildSnapshot, nowIsoPlus7 } from './snapshot-builder.js';
import { enrichReply } from './enricher.js';
import { exportSnapshot } from './exporter.js';
import {
  upsertReply, updateReplyEnrichment, getRepliesNeedingEnrichment,
  getRepliesInPeriod, getAllReplies,
} from '../database/reply-tracking.js';
import type { EnrichFn, ReplySnapshot } from './types.js';

const logger = createLogger('reply-tracking');

const DEFAULT_CONTENT = join(homedir(), 'Dev/vault/projects/content-creator/analytics/raw/content-latest.csv');
const DEFAULT_OVERVIEW = join(homedir(), 'Dev/vault/projects/content-creator/analytics/raw/overview-latest.csv');

export interface RunReplyAnalyzeOptions {
  contentPath?: string;
  overviewPath?: string;
  enrichFn?: EnrichFn;
  exportFn?: (snapshot: ReplySnapshot) => string;
  skipEnrich?: boolean;
  db?: Database.Database;
}

export interface ReplyAnalyzeResult {
  snapshot: ReplySnapshot;
  outputPath: string;
  enriched: number;
  enrichFailed: number;
  storedReplies: number;
}

export async function runReplyAnalyze(opts: RunReplyAnalyzeOptions = {}): Promise<ReplyAnalyzeResult> {
  const contentPath = opts.contentPath ?? DEFAULT_CONTENT;
  const overviewPath = opts.overviewPath ?? DEFAULT_OVERVIEW;
  const enrichFn = opts.enrichFn ?? enrichReply;
  const exportFn = opts.exportFn ?? exportSnapshot;
  const db = opts.db;

  const contentRows = parseContentCsv(contentPath);
  const overviewRows = parseOverviewCsv(overviewPath);

  // Period: prefer overview dates, fall back to content dates.
  const periodDates = (overviewRows.length > 0 ? overviewRows.map((r) => r.date) : contentRows.map((r) => r.postedDate));
  const period = derivePeriod(periodDates);

  // Store replies (originals are not persisted).
  const replyRows = contentRows.filter((r) => r.isReply);
  for (const r of replyRows) {
    upsertReply({
      post_id: r.postId,
      post_url: r.postLink || null,
      posted_date: r.postedDate,
      post_text: r.postText,
      kol_handle: r.kolHandle,
      niche: lookupNiche(r.kolHandle ?? ''),
      impressions: r.impressions,
      engagements: r.engagements,
      new_follows: r.newFollows,
    }, db);
  }
  logger.info(`Stored/updated ${replyRows.length} replies (${contentRows.length - replyRows.length} originals skipped)`);

  // Enrich only rows that have never been enriched.
  let enriched = 0;
  let enrichFailed = 0;
  if (!opts.skipEnrich) {
    const pending = getRepliesNeedingEnrichment(db);
    for (const row of pending) {
      try {
        const e = await enrichFn(row.post_id);
        updateReplyEnrichment(row.post_id, e, db);
        enriched += 1;
      } catch (err) {
        enrichFailed += 1;
        logger.warn(`Enrichment failed for reply ${row.post_id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const periodReplies = getRepliesInPeriod(period.start, period.end, db);
  const allReplies = getAllReplies(db);
  const snapshot = buildSnapshot(contentRows, periodReplies, allReplies, period, nowIsoPlus7());
  const outputPath = exportFn(snapshot);

  return { snapshot, outputPath, enriched, enrichFailed, storedReplies: replyRows.length };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/reply-tracking.test.ts -t "orchestrator"`
Expected: PASS.

- [ ] **Step 5: Create the CLI script**

Create `src/scripts/reply-analyze.ts`:

```ts
import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { initDb } from '../database/index.js';
import { requireTwitterApiIoKey } from '../config/index.js';
import { runReplyAnalyze } from '../reply-tracking/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('script:reply-analyze');

function flagValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : undefined;
}

async function main(): Promise<void> {
  const skipEnrich = process.argv.includes('--skip-enrich');
  const contentPath = flagValue('content');
  const overviewPath = flagValue('overview');

  // Fail fast with a clear message if the key is missing (unless CSV-only).
  if (!skipEnrich) {
    requireTwitterApiIoKey();
  }

  initDb();

  const res = await runReplyAnalyze({ contentPath, overviewPath, skipEnrich });
  const s = res.snapshot;

  console.log(`\nReply analysis — ${s.period.label}\n`);
  console.log(`  Replies:           ${s.summary.replyCount}  (originals: ${s.summary.originalCount})`);
  console.log(`  Reply imp share:   ${(s.summary.replyImpShare * 100).toFixed(0)}%`);
  console.log(`  Avg imp / reply:   ${s.summary.avgImpPerReply}  (original: ${s.summary.avgImpPerOriginal})`);
  console.log(`  Dud rate (<50):    ${(s.summary.dudRate * 100).toFixed(0)}%`);
  console.log(`  New follows:       ${s.summary.newFollowsFromReply} from replies / ${s.summary.newFollowsFromOriginal} from originals`);
  console.log(`  Enriched:          ${res.enriched}  (failed: ${res.enrichFailed})`);

  if (s.byKol.length > 0) {
    console.log('\n  Top KOLs by total impressions:\n');
    for (const k of s.byKol.slice(0, 10)) {
      console.log(`    ${k.handle.padEnd(20)} ${String(k.totalImp).padStart(6)} imp  ${k.replies} replies  (${k.niche})`);
    }
  }

  console.log('\n  By niche:\n');
  for (const n of s.byNiche) {
    console.log(`    ${n.niche.padEnd(12)} ${n.replies} replies  ${n.totalImp} imp  (avg ${n.avgImp})`);
  }

  console.log(`\n  Snapshot written: ${res.outputPath}\n`);
}

main().then(() => process.exit(0)).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(msg);
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
});
```

- [ ] **Step 6: Register the npm script**

In `package.json` `scripts`, add after `"brief"`:

```json
    "reply:analyze": "tsx src/scripts/reply-analyze.ts",
```

- [ ] **Step 7: Add the env var to `.env.example`**

Append to `.env.example`:

```
# TwitterAPI.io (reply enrichment — npm run reply:analyze)
TWITTERAPI_IO_KEY=
```

- [ ] **Step 8: Smoke test against the real CSVs (CSV-only, no API spend)**

Run: `npm run reply:analyze -- --skip-enrich`
Expected: prints a summary with non-zero reply count, a "By niche" block with all 4 niches, and `Snapshot written: …/reply-tracking/latest.json`.

- [ ] **Step 9: Verify the written JSON matches the contract**

Run: `npx tsx -e "import('node:fs').then(fs => { const j = JSON.parse(fs.readFileSync(process.env.HOME + '/Dev/vault/projects/content-creator/analytics/reply-tracking/latest.json','utf-8')); console.log('keys', Object.keys(j)); console.log('niches', j.byNiche.map(n=>n.niche)); console.log('generatedAt', j.generatedAt); })"`
Expected: keys = `generatedAt, period, summary, byKol, byNiche, byHour, parentSizeCorrelation, weeklyTrend`; niches = `['security','tokenomics','l1l2','other']`; `generatedAt` ends with `+07:00`.

- [ ] **Step 10: Commit**

```bash
git add src/reply-tracking/index.ts src/scripts/reply-analyze.ts package.json .env.example tests/reply-tracking.test.ts
git commit -m "feat(reply-tracking): orchestrator + reply:analyze CLI"
```

---

## Task 10: Full verification + release

**Files:**
- Modify: `package.json` (version)
- Modify: `CLAUDE.md` (version + state)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS — previous 39 tests + the new `reply-tracking.test.ts` cases all green.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 3: Bump version to 0.5.0**

In `package.json` set `"version": "0.5.0"`.

- [ ] **Step 4: Update CLAUDE.md**

- Change `## Current version: v0.4.3` → `## Current version: v0.5.0`.
- Add to the Commands block:
  ```bash
  npm run reply:analyze              # parse X Analytics CSVs → enrich via TwitterAPI.io → reply_tracking → snapshot JSON
  npm run reply:analyze -- --skip-enrich          # CSV-only, no API spend
  npm run reply:analyze -- --content=PATH --overview=PATH   # override CSV paths
  ```
- Add a Key files row for `src/reply-tracking/index.ts` (`runReplyAnalyze` orchestrator) and `src/config/kol-niches.ts` (KOL→niche map).
- Under "Current state", note: `reply_tracking` table added; KOL→niche config in `src/config/kol-niches.ts` synced by hand from vault `kol-reply-list.md`; snapshot contract at `<vault>/analytics/reply-tracking/latest.json`.

- [ ] **Step 5: Add CHANGELOG entry**

Add at the top of `CHANGELOG.md`:

```markdown
## [0.5.0] — Reply Tracking

- New `reply_tracking` table (accumulates reply history across weeks; idempotent on reply Post id).
- New `npm run reply:analyze`: reads X Analytics CSVs (content + overview), classifies replies vs originals, looks up KOL niche, enriches replies via TwitterAPI.io (reply hour + parent-tweet impressions/engagements), and writes a fixed-schema snapshot to `<vault>/analytics/reply-tracking/latest.json` for the Newsroom dashboard.
- KOL→niche config in `src/config/kol-niches.ts` (synced by hand from vault `kol-reply-list.md`); niches: security | tokenomics | l1l2 | other.
- New env var `TWITTERAPI_IO_KEY`; `--skip-enrich` runs CSV-only with no API spend.
```

- [ ] **Step 6: Commit the release**

```bash
git add package.json CLAUDE.md CHANGELOG.md
git commit -m "v0.5.0 — Reply Tracking"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Feature 1 (`reply_tracking` table, separate from posts/post_metrics, accumulates) → Task 1 + Task 5. ✓
- Feature 2 (`npm run reply:analyze`: 2 CSVs → analyze → enrich → DB → terminal summary → JSON) → Tasks 4, 9. ✓
- Feature 3 (KOL→niche config like rss-sources, seeded by hand from vault) → Task 2. ✓
- Feature 4 (enrich via TwitterAPI.io: KOL identity + parent tweet metrics; ~2 reads) → Task 7. ✓
- Feature 5 (JSON snapshot, fixed schema, overwrite) → Tasks 6, 8. ✓
- Hybrid input / no re-pull of reply metrics → orchestrator stores CSV imp/eng, enrich only fills parent + hour. ✓
- Provider/credential `TWITTERAPI_IO_KEY` → Tasks 7, 9. ✓
- Reply detection (`@` prefix, handle after first `@`) → Task 4 `extractKolHandle`. ✓
- Niche enum + unknown→other → Task 2. ✓
- Dud = imp < 50 → Task 6 `REPLY_THRESHOLDS`. ✓
- Idempotent on Post id, update on metric change → Task 5 upsert + test. ✓
- weeklyTrend from all DB rows → Task 6 `buildSnapshot(allReplies)`. ✓
- Parent imp = cumulative proxy → noted in snapshot `note`. ✓
- byNiche all 4, byKol sorted desc, parent bands `<1k|1k-10k|>10k` → Task 6 + tests. ✓
- Testing checklist (reply/original split, idempotency, per-reply API failure tolerance, missing key error, JSON path/schema, weeklyTrend multi-week, npm test + tsc) → Tasks 5, 7, 9, 10. ✓
- Release checklist → Task 10. ✓

**Placeholder scan:** One intentional artifact flagged in Task 4 Step 3 (a bogus self-import line) with an explicit instruction to delete it — included deliberately so the engineer removes it; all other steps contain complete code.

**Type consistency:** `EnrichFn`, `ReplyEnrichment`, `ReplyRow`, `InsertReply`, `Niche`, `ReplySnapshot` and section types are defined once (Tasks 3, 5) and referenced unchanged everywhere. `buildSnapshot(contentRows, periodReplies, allReplies, period, generatedAt)` signature matches its call in the orchestrator and its tests.

**Known live-API risk:** TwitterAPI.io field names/endpoint are assumptions isolated in `mapTweet`/`fetchTweet` (Task 7) — verify against docs before trusting real enrichment; unit tests pin the mapping and never hit the network.

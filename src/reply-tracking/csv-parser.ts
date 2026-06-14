import { readFileSync } from 'node:fs';
import type { ContentRow, OverviewRow, Period } from './types.js';

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

// X Analytics exports raw integer counts (e.g. "1,234"), not ranges — strip separators and parse.
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
    if (!rawDate) continue;
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

function addDaysIso(iso: string, delta: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * The reporting period is the latest week in the CSV: a 7-day window (inclusive)
 * ending at the max date. X Analytics CSVs export ~28 days, but summary/byKol/
 * byNiche/byHour must reflect only the most recent week — so we scope to it here.
 * (weeklyTrend is the one block that spans all accumulated DB rows, not this period.)
 */
export function derivePeriod(dates: string[]): Period {
  const sorted = dates.filter(Boolean).slice().sort();
  if (sorted.length === 0) {
    const today = new Date().toISOString().slice(0, 10);
    return { start: today, end: today, label: formatLabel(today, today) };
  }
  const end = sorted[sorted.length - 1]!;
  const start = addDaysIso(end, -6);
  return { start, end, label: formatLabel(start, end) };
}

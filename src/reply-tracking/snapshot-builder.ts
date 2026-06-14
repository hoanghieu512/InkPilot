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
  // --- summary (from content CSV, scoped to the period — the latest week) ---
  // The CSV spans ~28 days; summary must reflect only the period so its numbers
  // reconcile with byKol/byNiche/byHour (which are already period-scoped DB rows).
  const periodContent = contentRows.filter(
    (r) => r.postedDate >= period.start && r.postedDate <= period.end,
  );
  const replies = periodContent.filter((r) => r.isReply);
  const originals = periodContent.filter((r) => !r.isReply);
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

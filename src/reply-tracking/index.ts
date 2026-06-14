import { existsSync } from 'node:fs';
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
  upsertReply, updateReplyEnrichment, getRepliesNeedingEnrichmentInPeriod,
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

  if (!existsSync(contentPath)) {
    throw new Error(`Content CSV not found: ${contentPath}. Pass --content=<path> to override.`);
  }
  const contentRows = parseContentCsv(contentPath);

  let overviewRows: ReturnType<typeof parseOverviewCsv> = [];
  if (existsSync(overviewPath)) {
    overviewRows = parseOverviewCsv(overviewPath);
  } else {
    logger.warn(`Overview CSV not found: ${overviewPath} — period will be derived from content dates.`);
  }

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

  // Enrich only un-enriched replies inside the period (the latest week). Older weeks
  // stay in the DB for weeklyTrend but are never re-fetched — keeps API calls bounded
  // and idempotent across re-runs.
  let enriched = 0;
  let enrichFailed = 0;
  if (!opts.skipEnrich) {
    const pending = getRepliesNeedingEnrichmentInPeriod(period.start, period.end, db);
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

import { initDb, getDb } from '../database/index.js';
import { seedSources } from '../database/sources.js';
import { RSS_SOURCES } from '../config/rss-sources.js';
import { SCORE_THRESHOLDS } from '../config/index.js';
import type { ArticleState } from '../database/types.js';
import type Database from 'better-sqlite3';

interface CliFlags {
  today: boolean;
  days: number;
  limit: number;
  source?: string | undefined;
  state?: ArticleState | undefined;
  hot: boolean;
  other: boolean;
  all: boolean;
}

function parseFlags(): CliFlags {
  const args = process.argv.slice(2);
  const flags: CliFlags = {
    today: false,
    days: 30,
    limit: 20,
    hot: false,
    other: false,
    all: false,
  };

  for (const arg of args) {
    if (arg === '--today') {
      flags.today = true;
      flags.days = 1;
    } else if (arg === '--hot') flags.hot = true;
    else if (arg === '--other') flags.other = true;
    else if (arg === '--all') flags.all = true;
    else if (arg.startsWith('--days=')) {
      const n = parseInt(arg.split('=')[1]!, 10);
      if (!isNaN(n) && n > 0) flags.days = n;
    } else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.split('=')[1]!, 10);
      if (!isNaN(n) && n > 0) flags.limit = n;
    } else if (arg.startsWith('--source=')) {
      flags.source = arg.split('=')[1];
    } else if (arg.startsWith('--state=')) {
      flags.state = arg.split('=')[1] as ArticleState;
    }
  }

  return flags;
}

interface ScoredArticleRow {
  id: number;
  title: string;
  source_name: string | null;
  source_slug: string | null;
  published_at: string | null;
  fetched_at: string;
  article_state: string | null;
  score: number | null;
  suggested_angle: string | null;
  category: string | null;
}

function buildArticleConditions(flags: CliFlags): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  conditions.push(`a.published_at >= datetime('now', '-${flags.days} days')`);

  if (flags.today) {
    conditions.push("a.fetched_at >= datetime('now', '-24 hours')");
  }

  if (flags.source) {
    conditions.push('s.slug = ?');
    params.push(flags.source);
  }

  if (flags.state) {
    conditions.push('ast.state = ?');
    params.push(flags.state);
  }

  if (flags.hot) {
    conditions.push(`fr.score >= ${SCORE_THRESHOLDS.HOT}`);
    conditions.push("ast.state != 'dismissed'");
  } else if (flags.other) {
    conditions.push(`fr.score >= ${SCORE_THRESHOLDS.OTHER_MIN}`);
    conditions.push(`fr.score < ${SCORE_THRESHOLDS.HOT}`);
    conditions.push("ast.state != 'dismissed'");
  } else if (!flags.all) {
    conditions.push(`fr.score >= ${SCORE_THRESHOLDS.OTHER_MIN}`);
    conditions.push("ast.state != 'dismissed'");
  }

  return { conditions, params };
}

const ARTICLE_JOINS = `
  FROM articles a
  LEFT JOIN sources s ON a.source_id = s.id
  LEFT JOIN article_states ast ON a.id = ast.article_id
  LEFT JOIN filter_results fr ON a.id = fr.article_id
`;

function queryScoredArticles(
  flags: CliFlags,
  db: Database.Database,
): ScoredArticleRow[] {
  const { conditions, params } = buildArticleConditions(flags);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = (flags.hot || flags.other || (!flags.all && !flags.state))
    ? 'ORDER BY fr.score DESC, a.fetched_at DESC'
    : 'ORDER BY a.fetched_at DESC';

  const sql = `
    SELECT a.id, a.title, a.published_at, a.fetched_at,
           s.slug as source_slug, s.name as source_name,
           ast.state as article_state,
           fr.score, fr.suggested_angle, fr.category
    ${ARTICLE_JOINS}
    ${where}
    ${orderBy}
    LIMIT ?
  `;

  return db.prepare(sql).all(...params, flags.limit) as ScoredArticleRow[];
}

function countScoredArticles(
  flags: CliFlags,
  db: Database.Database,
): number {
  const { conditions, params } = buildArticleConditions(flags);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT COUNT(*) AS cnt ${ARTICLE_JOINS} ${where}`;
  return (db.prepare(sql).get(...params) as { cnt: number }).cnt;
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return 'unknown';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function padRight(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width - 1) + '…';
  return text + ' '.repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  if (text.length >= width) return text;
  return ' '.repeat(width - text.length) + text;
}

function renderTieredView(flags: CliFlags, db: Database.Database): void {
  const hotFlags = { ...flags, hot: true, other: false, all: false };
  const otherFlags = { ...flags, hot: false, other: true, all: false };
  const hotArticles = queryScoredArticles(hotFlags, db);
  const otherArticles = queryScoredArticles(otherFlags, db);
  const totalHot = countScoredArticles(hotFlags, db);
  const totalOther = countScoredArticles(otherFlags, db);

  const LINE_WIDTH = 90;

  if (hotArticles.length > 0) {
    console.log(`\nHOT  \u{1F525} (score ${SCORE_THRESHOLDS.HOT}+)`);
    console.log('─'.repeat(LINE_WIDTH));
    for (const row of hotArticles) {
      const scoreStr = row.score != null ? `[${row.score.toFixed(1)}]` : '[?.?]';
      const source = row.source_name ?? row.source_slug ?? '';
      const time = formatTimeAgo(row.published_at ?? row.fetched_at);
      console.log(
        `${padRight(scoreStr, 6)} ${padLeft(String(row.id), 4)}  ${padRight(row.title, 44)}  ${padRight(source, 16)}  ${time}`
      );
      if (row.suggested_angle) {
        console.log(`            → ${row.suggested_angle}`);
      }
    }
  }

  if (otherArticles.length > 0) {
    console.log(`\nOTHER  (score ${SCORE_THRESHOLDS.OTHER_MIN}–${SCORE_THRESHOLDS.HOT - 0.1})`);
    console.log('─'.repeat(LINE_WIDTH));
    for (const row of otherArticles) {
      const scoreStr = row.score != null ? `[${row.score.toFixed(1)}]` : '[?.?]';
      const source = row.source_name ?? row.source_slug ?? '';
      const time = formatTimeAgo(row.published_at ?? row.fetched_at);
      console.log(
        `${padRight(scoreStr, 6)} ${padLeft(String(row.id), 4)}  ${padRight(row.title, 44)}  ${padRight(source, 16)}  ${time}`
      );
    }
  }

  if (hotArticles.length === 0 && otherArticles.length === 0) {
    console.log('\nNo scored articles found. Try running `npm run fetch` first.\n');
    return;
  }

  console.log();
  const hotSuffix = totalHot > hotArticles.length ? ` of ${totalHot}` : '';
  const otherSuffix = totalOther > otherArticles.length ? ` of ${totalOther}` : '';
  console.log(`Showing ${hotArticles.length}${hotSuffix} hot, ${otherArticles.length}${otherSuffix} other (last ${flags.days} days). Use --days=N or --limit=N to adjust.`);
  console.log();
}

function renderFlatView(flags: CliFlags, db: Database.Database): void {
  const articles = queryScoredArticles(flags, db);

  if (articles.length === 0) {
    console.log('\nNo articles found. Try running `npm run fetch` first.\n');
    return;
  }

  const hasScores = articles.some((a) => a.score != null);
  const LINE_WIDTH = 90;

  console.log();
  if (hasScores) {
    console.log(
      `${padRight('Score', 6)} ${padLeft('#', 4)}  ${padRight('Title', 44)}  ${padRight('Source', 16)}  ${padRight('Published', 10)}  ${padRight('State', 10)}`
    );
  } else {
    console.log(
      `${padLeft('#', 5)}  ${padRight('Title', 45)}  ${padRight('Source', 18)}  ${padRight('Published', 12)}  ${padRight('State', 10)}`
    );
  }
  console.log('─'.repeat(LINE_WIDTH));

  for (const row of articles) {
    const source = row.source_name ?? row.source_slug ?? '';
    const time = formatTimeAgo(row.published_at ?? row.fetched_at);
    const state = row.article_state ?? 'new';

    if (hasScores) {
      const scoreStr = row.score != null ? `[${row.score.toFixed(1)}]` : '      ';
      console.log(
        `${padRight(scoreStr, 6)} ${padLeft(String(row.id), 4)}  ${padRight(row.title, 44)}  ${padRight(source, 16)}  ${padRight(time, 10)}  ${state}`
      );
      if (row.suggested_angle && row.score != null && row.score >= SCORE_THRESHOLDS.HOT) {
        console.log(`            → ${row.suggested_angle}`);
      }
    } else {
      console.log(
        `${padLeft(String(row.id), 5)}  ${padRight(row.title, 45)}  ${padRight(source, 18)}  ${padRight(time, 12)}  ${state}`
      );
    }
  }

  const total = countScoredArticles(flags, db);
  const qualifier = [
    flags.today ? '(today)' : '',
    flags.source ? `from ${flags.source}` : '',
    flags.hot ? '(hot only)' : '',
    flags.other ? '(other only)' : '',
  ].filter(Boolean).join(' ');

  const countLabel = total > articles.length ? `${articles.length} of ${total}` : `${articles.length}`;
  console.log();
  console.log(`Showing ${countLabel} article(s) ${qualifier} (last ${flags.days} days). Use --days=N or --limit=N to adjust.`.trim());
  console.log();
}

function main(): void {
  initDb();
  seedSources(RSS_SOURCES);

  const flags = parseFlags();
  const db = getDb();

  const usesTieredView = !flags.hot && !flags.other && !flags.all && !flags.state;

  if (usesTieredView) {
    renderTieredView(flags, db);
  } else {
    renderFlatView(flags, db);
  }
}

main();

import { initDb, getDb } from '../database/index.js';
import { SCORE_THRESHOLDS } from '../config/index.js';

function parseDays(): number {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  if (arg) {
    const n = parseInt(arg.split('=')[1]!, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 7;
}

function pct(n: number, total: number): string {
  if (total === 0) return '—';
  return `${Math.round((n / total) * 100)}%`;
}

interface SourceStatsRow {
  source_name: string;
  total: number;
  avg_score: number | null;
  hot: number;
  other: number;
  dismissed: number;
}

function main(): void {
  initDb();
  const db = getDb();
  const days = parseDays();
  const since = `-${days} days`;

  const rows = db.prepare(`
    SELECT
      COALESCE(s.name, 'unknown') as source_name,
      COUNT(*) as total,
      AVG(fr.score) as avg_score,
      SUM(CASE WHEN fr.score >= ${SCORE_THRESHOLDS.HOT}              THEN 1 ELSE 0 END) as hot,
      SUM(CASE WHEN fr.score >= ${SCORE_THRESHOLDS.OTHER_MIN} AND fr.score < ${SCORE_THRESHOLDS.HOT} THEN 1 ELSE 0 END) as other,
      SUM(CASE WHEN fr.score < ${SCORE_THRESHOLDS.OTHER_MIN}               THEN 1 ELSE 0 END) as dismissed
    FROM filter_results fr
    JOIN articles a ON fr.article_id = a.id
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE fr.scored_at >= datetime('now', ?)
    GROUP BY a.source_id
    ORDER BY hot DESC, avg_score DESC
  `).all(since) as SourceStatsRow[];

  if (rows.length === 0) {
    console.log(`\nNo scored articles in the last ${days} days. Run \`npm run fetch\` first.\n`);
    return;
  }

  const nameW = Math.max(6, ...rows.map((r) => r.source_name.length));

  console.log(`\nSource stats — last ${days} day${days === 1 ? '' : 's'}\n`);
  console.log(
    `  ${'Source'.padEnd(nameW)}  ${'Total'.padStart(5)}  ${'Avg'.padStart(4)}  ${'HOT'.padStart(4)}  ${'OTHER'.padStart(5)}  ${'Dismissed'.padStart(9)}  ${'HOT%'.padStart(5)}`
  );
  console.log('  ' + '─'.repeat(nameW + 46));

  for (const r of rows) {
    const avg = r.avg_score != null ? r.avg_score.toFixed(1) : '—  ';
    const hotRate = pct(r.hot, r.total);
    const hotFlag = r.hot > 0 ? ' ✓' : '';
    console.log(
      `  ${r.source_name.padEnd(nameW)}  ${String(r.total).padStart(5)}  ${avg.padStart(4)}  ${String(r.hot).padStart(4)}  ${String(r.other).padStart(5)}  ${String(r.dismissed).padStart(9)}  ${hotRate.padStart(5)}${hotFlag}`
    );
  }

  const totHot = rows.reduce((s, r) => s + r.hot, 0);
  const totAll = rows.reduce((s, r) => s + r.total, 0);
  console.log('  ' + '─'.repeat(nameW + 46));
  console.log(
    `  ${'TOTAL'.padEnd(nameW)}  ${String(totAll).padStart(5)}  ${''.padStart(4)}  ${String(totHot).padStart(4)}  ${''.padStart(5)}  ${''.padStart(9)}  ${pct(totHot, totAll).padStart(5)}`
  );

  console.log();
}

main();

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
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

function bar(n: number, total: number, width = 30): string {
  if (total === 0) return '';
  return '█'.repeat(Math.max(0, Math.round((n / total) * width)));
}

function main(): void {
  initDb();
  const db = getDb();
  const days = parseDays();
  const since = `-${days} days`;

  interface TotalsRow {
    total: number;
    hot: number;
    other: number;
    dismissed: number;
    avg_score: number | null;
    b0_3: number;
    b3_5: number;
    b5_6: number;
    b6_7: number;
    b7_75: number;
    b75_8: number;
    b8_9: number;
    b9_10: number;
  }

  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN score >= ${SCORE_THRESHOLDS.HOT}              THEN 1 ELSE 0 END) as hot,
      SUM(CASE WHEN score >= ${SCORE_THRESHOLDS.OTHER_MIN} AND score < ${SCORE_THRESHOLDS.HOT} THEN 1 ELSE 0 END) as other,
      SUM(CASE WHEN score < ${SCORE_THRESHOLDS.OTHER_MIN}             THEN 1 ELSE 0 END) as dismissed,
      AVG(score) as avg_score,
      SUM(CASE WHEN score >= 0   AND score < 3   THEN 1 ELSE 0 END) as b0_3,
      SUM(CASE WHEN score >= 3   AND score < 5   THEN 1 ELSE 0 END) as b3_5,
      SUM(CASE WHEN score >= 5   AND score < 6   THEN 1 ELSE 0 END) as b5_6,
      SUM(CASE WHEN score >= 6   AND score < 7   THEN 1 ELSE 0 END) as b6_7,
      SUM(CASE WHEN score >= 7.0 AND score < ${SCORE_THRESHOLDS.HOT} THEN 1 ELSE 0 END) as b7_75,
      SUM(CASE WHEN score >= ${SCORE_THRESHOLDS.HOT} AND score < 8   THEN 1 ELSE 0 END) as b75_8,
      SUM(CASE WHEN score >= 8   AND score < 9   THEN 1 ELSE 0 END) as b8_9,
      SUM(CASE WHEN score >= 9   AND score <= 10 THEN 1 ELSE 0 END) as b9_10
    FROM filter_results
    WHERE scored_at >= datetime('now', ?)
  `).get(since) as TotalsRow;

  if (row.total === 0) {
    console.log(`\nNo scored articles in the last ${days} days. Run \`npm run fetch\` first.\n`);
    return;
  }

  console.log(`\nScoring stats — last ${days} day${days === 1 ? '' : 's'}\n`);
  console.log(`  Total scored:  ${row.total}`);
  console.log(`  HOT (${SCORE_THRESHOLDS.HOT}+):    ${row.hot}  (${pct(row.hot, row.total)})`);
  console.log(`  OTHER (${SCORE_THRESHOLDS.OTHER_MIN}–${SCORE_THRESHOLDS.HOT - 0.1}): ${row.other}  (${pct(row.other, row.total)})`);
  console.log(`  Dismissed:     ${row.dismissed}  (${pct(row.dismissed, row.total)})`);
  console.log(`  Avg score:     ${row.avg_score != null ? row.avg_score.toFixed(2) : '—'}`);

  console.log('\n  Score histogram:\n');
  console.log(`  ${'Range'.padEnd(6)}  ${'Count'.padStart(5)}  Bar`);
  console.log('  ' + '─'.repeat(50));

  const buckets: Array<{ label: string; count: number }> = [
    { label: '0–3',     count: row.b0_3 },
    { label: '3–5',     count: row.b3_5 },
    { label: '5–6',     count: row.b5_6 },
    { label: '6–7',     count: row.b6_7 },
    { label: `7–${SCORE_THRESHOLDS.HOT}`,  count: row.b7_75 },
    { label: `${SCORE_THRESHOLDS.HOT}–8`, count: row.b75_8 },
    { label: '8–9',     count: row.b8_9 },
    { label: '9–10',    count: row.b9_10 },
  ];

  for (const b of buckets) {
    const isHot = b.label === `${SCORE_THRESHOLDS.HOT}–8` || b.label === '8–9' || b.label === '9–10';
    const isNearHot = b.label === `7–${SCORE_THRESHOLDS.HOT}`;
    const tag = isHot ? ' ← HOT' : isNearHot ? ' ← near-HOT' : '';
    console.log(`  ${b.label.padEnd(8)}  ${String(b.count).padStart(5)}  ${bar(b.count, row.total)}${tag}`);
  }

  // Category breakdown (Haiku-assigned categories)
  const cats = db.prepare(`
    SELECT category, COUNT(*) as cnt
    FROM filter_results
    WHERE scored_at >= datetime('now', ?)
      AND category IS NOT NULL AND category != ''
    GROUP BY category
    ORDER BY cnt DESC
  `).all(since) as Array<{ category: string; cnt: number }>;

  if (cats.length > 0) {
    console.log('\n  By Haiku category:\n');
    const catW = Math.max(8, ...cats.map((c) => c.category.length));
    console.log(`  ${'Category'.padEnd(catW)}  Count`);
    console.log('  ' + '─'.repeat(catW + 8));
    for (const c of cats) {
      console.log(`  ${c.category.padEnd(catW)}  ${c.cnt}`);
    }
  }

  console.log();
}

main();

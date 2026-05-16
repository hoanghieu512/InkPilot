import { initDb, getDb } from '../database/index.js';

function parseArgs(): { limit: number; days: number } {
  const args = process.argv.slice(2);
  let limit = 10;
  let days = 30;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.split('=')[1]!, 10);
      if (!isNaN(n) && n > 0) limit = n;
    } else if (arg.startsWith('--days=')) {
      const n = parseInt(arg.split('=')[1]!, 10);
      if (!isNaN(n) && n > 0) days = n;
    }
  }

  return { limit, days };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'unknown';
  return new Date(dateStr).toISOString().split('T')[0]!;
}

interface NearHotRow {
  article_id: number;
  title: string;
  source_name: string | null;
  published_at: string | null;
  score: number;
  reasoning: string | null;
  suggested_angle: string | null;
}

function main(): void {
  initDb();
  const db = getDb();
  const { limit, days } = parseArgs();
  const since = `-${days} days`;

  const rows = db.prepare(`
    SELECT
      a.id as article_id,
      a.title,
      COALESCE(s.name, 'unknown') as source_name,
      a.published_at,
      fr.score,
      fr.reasoning,
      fr.suggested_angle
    FROM filter_results fr
    JOIN articles a ON fr.article_id = a.id
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE fr.score >= 7.0 AND fr.score < 8.0
      AND fr.scored_at >= datetime('now', ?)
    ORDER BY fr.score DESC, fr.scored_at DESC
    LIMIT ?
  `).all(since, limit) as NearHotRow[];

  if (rows.length === 0) {
    console.log(`\nNo near-HOT articles (score 7–7.9) in the last ${days} days.\n`);
    return;
  }

  const divider = '─'.repeat(80);

  console.log(`\nNear-HOT articles (score 7.0–7.9) — last ${days} days, showing ${rows.length}\n`);

  for (const row of rows) {
    console.log(divider);
    console.log(`Score:   ${row.score.toFixed(1)}  |  #${row.article_id}  |  ${row.source_name ?? ''}  |  ${formatDate(row.published_at)}`);
    console.log(`Title:   ${row.title}`);
    if (row.suggested_angle) {
      console.log(`Angle:   ${row.suggested_angle}`);
    }
    console.log();
    if (row.reasoning) {
      console.log(`Reasoning:\n${row.reasoning}`);
    } else {
      console.log('Reasoning: (none)');
    }
    console.log();
  }

  console.log(divider);
  console.log(`\n${rows.length} near-HOT article${rows.length === 1 ? '' : 's'} shown. Use --limit=N or --days=N to adjust.\n`);
}

main();

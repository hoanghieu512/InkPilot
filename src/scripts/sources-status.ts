import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { initDb } from '../database/index.js';
import { seedSources, getSourcesStatus } from '../database/sources.js';
import { RSS_SOURCES } from '../config/rss-sources.js';

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toISOString().split('T')[0]!;
}

function main(): void {
  initDb();
  seedSources(RSS_SOURCES);

  const rows = getSourcesStatus();

  const nameWidth = Math.max(...rows.map((r) => r.name.length));
  const header =
    'Source'.padEnd(nameWidth) +
    '  Status    Articles  Last article    Last fetch';
  const divider = '─'.repeat(header.length);

  console.log('\nSources status:\n');
  console.log('  ' + header);
  console.log('  ' + divider);

  for (const row of rows) {
    const status = row.enabled ? 'enabled  ' : 'disabled ';
    const count = String(row.article_count).padStart(5) + ' arts';
    const lastArticle = timeAgo(row.last_article_date).padEnd(14);
    const lastFetch = timeAgo(row.last_fetched_at);
    console.log(
      `  ${row.name.padEnd(nameWidth)}  ${status}  ${count}  ${lastArticle}  ${lastFetch}`,
    );
  }

  console.log();
}

main();

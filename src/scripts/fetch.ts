import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { initDb } from '../database/index.js';
import { seedSources, repairArticleSourceIds } from '../database/sources.js';
import { RSS_SOURCES } from '../config/rss-sources.js';
import { runFetch } from '../feed-fetcher/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('script:fetch');

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

async function main(): Promise<void> {
  initDb();
  seedSources(RSS_SOURCES);
  repairArticleSourceIds(RSS_SOURCES);

  const verbose = process.argv.includes('--verbose');
  const result = await runFetch(undefined, undefined, verbose);

  console.log(`\nFetch complete:`);
  console.log(`  Sources checked: ${result.sourcesChecked}`);
  console.log(`  New articles:    ${result.newArticles}`);
  console.log(`  Duplicates:      ${result.duplicatesSkipped}`);

  if (result.scoring) {
    const s = result.scoring;
    console.log(`  Scored:          ${s.scored} (HOT: ${s.hotCount}, OTHER: ${s.otherCount}, Dismissed: ${s.dismissedCount})`);
    console.log(`  Cost:            $${s.estimatedCostUsd.toFixed(4)} (Haiku: ${formatTokens(s.totalTokensIn)} in, ${formatTokens(s.totalTokensOut)} out tokens)`);
  }

  if (result.errors.length > 0) {
    console.log(`  Errors (${result.errors.length}):`);
    for (const e of result.errors) {
      console.log(`    - ${e.source}: ${e.error}`);
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  logger.error('Fetch failed', { error: String(err) });
  process.exit(1);
});

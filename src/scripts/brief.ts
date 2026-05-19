import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { initDb } from '../database/index.js';
import { seedSources } from '../database/sources.js';
import { RSS_SOURCES } from '../config/rss-sources.js';
import { generateBrief } from '../research-briefer/index.js';
import { printBrief } from '../research-briefer/formatter.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('script:brief');

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const forceRefresh = process.argv.includes('--refresh');
  const articleId = parseInt(args[0] ?? '', 10);

  if (!articleId || isNaN(articleId)) {
    console.error('Usage: npm run brief <article-id> [--refresh]');
    console.error('Example: npm run brief 42');
    console.error('         npm run brief 42 --refresh  # force regenerate');
    process.exit(1);
  }

  initDb();
  seedSources(RSS_SOURCES);

  const brief = await generateBrief(articleId, { forceRefresh });
  printBrief(brief);
}

main().then(() => process.exit(0)).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(msg);
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
});

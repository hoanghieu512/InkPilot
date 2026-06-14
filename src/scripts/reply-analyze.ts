import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { initDb } from '../database/index.js';
import { requireTwitterApiIoKey } from '../config/index.js';
import { runReplyAnalyze } from '../reply-tracking/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('script:reply-analyze');

function flagValue(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : undefined;
}

async function main(): Promise<void> {
  const skipEnrich = process.argv.includes('--skip-enrich');
  const contentPath = flagValue('content');
  const overviewPath = flagValue('overview');

  // Fail fast with a clear message if the key is missing (unless CSV-only).
  if (!skipEnrich) {
    requireTwitterApiIoKey();
  }

  initDb();

  const res = await runReplyAnalyze({
    ...(contentPath !== undefined ? { contentPath } : {}),
    ...(overviewPath !== undefined ? { overviewPath } : {}),
    skipEnrich,
  });
  const s = res.snapshot;

  console.log(`\nReply analysis — ${s.period.label}\n`);
  console.log(`  Replies:           ${s.summary.replyCount}  (originals: ${s.summary.originalCount})`);
  console.log(`  Reply imp share:   ${(s.summary.replyImpShare * 100).toFixed(0)}%`);
  console.log(`  Avg imp / reply:   ${s.summary.avgImpPerReply}  (original: ${s.summary.avgImpPerOriginal})`);
  console.log(`  Dud rate (<50):    ${(s.summary.dudRate * 100).toFixed(0)}%`);
  console.log(`  New follows:       ${s.summary.newFollowsFromReply} from replies / ${s.summary.newFollowsFromOriginal} from originals`);
  console.log(`  Enriched:          ${res.enriched}  (failed: ${res.enrichFailed})`);

  if (s.byKol.length > 0) {
    console.log('\n  Top KOLs by total impressions:\n');
    for (const k of s.byKol.slice(0, 10)) {
      console.log(`    ${k.handle.padEnd(20)} ${String(k.totalImp).padStart(6)} imp  ${k.replies} replies  (${k.niche})`);
    }
  }

  console.log('\n  By niche:\n');
  for (const n of s.byNiche) {
    console.log(`    ${n.niche.padEnd(12)} ${n.replies} replies  ${n.totalImp} imp  (avg ${n.avgImp})`);
  }

  console.log(`\n  Snapshot written: ${res.outputPath}\n`);
}

main().then(() => process.exit(0)).catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(msg);
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
});

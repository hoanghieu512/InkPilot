import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ReplySnapshot } from './types.js';

const OUTPUT_DIR = join(
  homedir(),
  'Dev/vault/projects/content-creator/analytics/reply-tracking',
);

/** Writes the fixed-schema snapshot to <vault>/.../reply-tracking/latest.json. */
export function exportSnapshot(snapshot: ReplySnapshot): string {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, 'latest.json');
  writeFileSync(outputPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
  return outputPath;
}

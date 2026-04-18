import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { Brief } from './types.js';

const TEMPLATE_PATH = join(homedir(), 'Dev/vault/templates/angle-template.md');

const OUTPUT_DIR = join(homedir(), 'Dev/vault/projects/content-creator/angles');

function formatTimeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return 'unknown';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export function exportAngleFile(brief: Brief): string {
  if (!existsSync(TEMPLATE_PATH)) {
    throw new Error(`Template not found: ${TEMPLATE_PATH}`);
  }
  const template = readFileSync(TEMPLATE_PATH, 'utf-8');

  const relatedStoriesText =
    brief.relatedArticles.length > 0
      ? brief.relatedArticles
          .map(
            (r) =>
              `- [${r.score.toFixed(1)}] #${r.id} ${r.title} — ${formatTimeAgo(r.publishedAt)}\n  ${r.url}`,
          )
          .join('\n')
      : '_No related stories found._';

  const vietnameseAnglesText =
    brief.suggestedAngles.vietnamese.length > 0
      ? brief.suggestedAngles.vietnamese
          .map((a, i) => `**Angle ${i + 1}**\n${a}`)
          .join('\n\n')
      : '_No Vietnamese angles generated._';

  const englishAnglesText =
    brief.suggestedAngles.english.length > 0
      ? brief.suggestedAngles.english
          .map((a, i) => `**Angle ${i + 1}**\n${a}`)
          .join('\n\n')
      : '_No English angles generated._';

  const dateStr = new Date().toISOString().split('T')[0]!;

  const content = template
    .replace('__DATE__', dateStr)
    .replace('__ARTICLE_ID__', String(brief.articleId))
    .replace('__TITLE__', brief.articleTitle.replace(/"/g, '\\"'))
    .replace('__SOURCE__', brief.sourceName)
    .replace('__SCORE__', String(brief.score))
    .replace('__URL__', brief.articleUrl)
    .replace('__WHY_IT_MATTERS__', brief.whyItMatters)
    .replace('__RELATED_STORIES__', relatedStoriesText)
    .replace('__VIETNAMESE_ANGLES__', vietnameseAnglesText)
    .replace('__ENGLISH_ANGLES__', englishAnglesText);

  const slug = (() => {
    const s = brief.articleTitle
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .join('-');
    return s || 'untitled';
  })();

  const filename = `${dateStr}-${brief.articleId}-${slug}.md`;
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const outputPath = join(OUTPUT_DIR, filename);
  writeFileSync(outputPath, content, 'utf-8');
  return outputPath;
}

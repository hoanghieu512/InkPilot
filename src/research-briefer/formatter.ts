import { homedir } from 'os';
import type { Brief } from './types.js';

const DOUBLE_LINE = '\u2550'.repeat(62);

function toTildePath(absolutePath: string): string {
  const home = homedir();
  if (absolutePath.startsWith(home)) {
    return `~${absolutePath.slice(home.length)}`;
  }
  return absolutePath;
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr || dateStr === 'Unknown') return 'unknown';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function wrapText(text: string, width: number, indent: string = ''): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 > width) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines.map((l, i) => (i === 0 ? l : indent + l)).join('\n');
}

export function printBrief(brief: Brief): void {
  const timeAgo = formatTimeAgo(brief.publishedAt);

  console.log();
  console.log(DOUBLE_LINE);
  console.log(`BRIEF #${brief.articleId} \u2014 ${brief.articleTitle}`);
  console.log(`Source: ${brief.sourceName}  |  Score: ${brief.score.toFixed(1)}  |  Published: ${timeAgo}`);
  console.log(`URL: ${brief.articleUrl}`);
  console.log(DOUBLE_LINE);

  console.log();
  console.log('WHY IT MATTERS');
  console.log(wrapText(brief.whyItMatters, 60));

  if (brief.relatedArticles.length > 0) {
    console.log();
    console.log('RELATED STORIES (last 7 days)');
    for (const r of brief.relatedArticles) {
      const scoreStr = `[${r.score.toFixed(1)}]`;
      const time = formatTimeAgo(r.publishedAt);
      console.log(`  ${scoreStr}  #${r.id}  ${r.title}  \u2014  ${time}`);
    }
  }

  console.log();
  console.log('SUGGESTED ANGLES');

  if (brief.suggestedAngles.vietnamese.length > 0) {
    console.log();
    console.log('  \uD83C\uDDFB\uD83C\uDDF3  Ti\u1EBFng Vi\u1EC7t');
    for (let i = 0; i < brief.suggestedAngles.vietnamese.length; i++) {
      const wrapped = wrapText(brief.suggestedAngles.vietnamese[i]!, 56, '      ');
      console.log(`  ${i + 1}.  ${wrapped}`);
    }
  }

  if (brief.suggestedAngles.english.length > 0) {
    console.log();
    console.log('  \uD83C\uDF10  English');
    for (let i = 0; i < brief.suggestedAngles.english.length; i++) {
      const wrapped = wrapText(brief.suggestedAngles.english[i]!, 56, '      ');
      console.log(`  ${i + 1}.  ${wrapped}`);
    }
  }

  if (brief.suggestedAngles.vietnamese.length === 0 && brief.suggestedAngles.english.length === 0) {
    console.log('  (no angles generated)');
  }

  console.log();
  console.log(DOUBLE_LINE);

  if (brief.cached) {
    console.log('(cached \u2014 no API call)');
  } else if (brief.tokensIn != null && brief.tokensOut != null && brief.estimatedCostUsd != null) {
    console.log(`Cost: $${brief.estimatedCostUsd.toFixed(2)}  |  Sonnet: ${formatTokens(brief.tokensIn)} in / ${formatTokens(brief.tokensOut)} out tokens`);
  }

  if (brief.savedAnglePath) {
    console.log();
    console.log(`\uD83D\uDCBE  Saved: ${toTildePath(brief.savedAnglePath)}`);
  }

  console.log(DOUBLE_LINE);
  console.log();
}

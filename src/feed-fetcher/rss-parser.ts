import Parser from 'rss-parser';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('feed-fetcher:rss');

export interface FeedItem {
  url: string;
  title: string;
  publishedAt: string | null;
  contentSnippet: string | null;
  author: string | null;
}

const parser = new Parser({
  timeout: 10_000,
  headers: {
    'User-Agent': 'InkPilot/0.1 RSS Reader',
    Accept: 'application/rss+xml, application/xml, text/xml',
  },
});

export async function fetchFeed(url: string): Promise<FeedItem[]> {
  logger.debug(`Fetching feed: ${url}`);
  const feed = await parser.parseURL(url);

  const items: FeedItem[] = [];
  for (const entry of feed.items) {
    const link = entry.link ?? entry.guid;
    if (!link || !entry.title) continue;

    items.push({
      url: link,
      title: entry.title,
      publishedAt: entry.isoDate ?? entry.pubDate ?? null,
      contentSnippet: truncate(entry.contentSnippet ?? entry.content ?? null, 500),
      author: entry.creator ?? entry['dc:creator'] ?? null,
    });
  }

  logger.debug(`Parsed ${items.length} items from ${url}`);
  return items;
}

function truncate(text: string | null, max: number): string | null {
  if (!text) return null;
  const cleaned = text.replace(/<[^>]*>/g, '').trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max - 3) + '...';
}

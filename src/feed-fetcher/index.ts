import { createLogger } from '../utils/logger.js';
import { getEnabledSources, updateLastFetchedAt } from '../database/sources.js';
import { insertArticle, updateOgImage } from '../database/articles.js';
import { createArticleState } from '../database/article-states.js';
import { fetchFeed } from './rss-parser.js';
import { extractOgImageUrl } from './og-extractor.js';
import type { Source } from '../database/types.js';
import type { FeedItem } from './rss-parser.js';
import type Database from 'better-sqlite3';

const logger = createLogger('feed-fetcher');

export interface ScoringResult {
  scored: number;
  hotCount: number;
  otherCount: number;
  dismissedCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  estimatedCostUsd: number;
}

export interface FetchResult {
  sourcesChecked: number;
  newArticles: number;
  duplicatesSkipped: number;
  errors: Array<{ source: string; error: string }>;
  scoring?: ScoringResult | undefined;
}

interface NewArticleRef {
  id: number;
  url: string;
}

export async function runFetch(db?: Database.Database, skipScoring?: boolean, verbose?: boolean): Promise<FetchResult> {
  const sources = getEnabledSources(db);
  logger.info(`Starting fetch for ${sources.length} enabled sources`);

  const result: FetchResult = {
    sourcesChecked: sources.length,
    newArticles: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  const feedResults = await Promise.allSettled(
    sources.map((source) => fetchSingleSource(source))
  );

  const allNewArticles: NewArticleRef[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    const feedResult = feedResults[i]!;

    if (feedResult.status === 'rejected') {
      const errMsg = feedResult.reason instanceof Error
        ? feedResult.reason.message
        : String(feedResult.reason);
      logger.warn(`Feed error for ${source.name}: ${errMsg}`);
      result.errors.push({ source: source.name, error: errMsg });
      continue;
    }

    const items = feedResult.value;
    let sourceNew = 0;
    let sourceDup = 0;
    for (const item of items) {
      const insertResult = insertArticle({
        url: item.url,
        title: item.title,
        author: item.author ?? undefined,
        published_at: item.publishedAt ?? undefined,
        content: item.contentSnippet ?? undefined,
        source_id: source.id,
      }, db);

      if (insertResult.inserted && insertResult.id != null) {
        result.newArticles++;
        sourceNew++;
        createArticleState(insertResult.id, 'new', db);
        allNewArticles.push({ id: insertResult.id, url: item.url });
      } else {
        result.duplicatesSkipped++;
        sourceDup++;
      }
    }

    if (verbose) {
      logger.info(`  ${source.name}: ${items.length} items → ${sourceNew} new, ${sourceDup} duplicates`);
    }

    updateLastFetchedAt(source.id, db);
  }

  if (allNewArticles.length > 0) {
    logger.info(`Extracting OG images for ${allNewArticles.length} new articles...`);
    await extractOgImagesWithConcurrency(allNewArticles, 5, db);
  }

  if (skipScoring !== true) {
    const { filterNewArticles, getUnscoredNewArticleIds } = await import('../content-filter/index.js');
    const newIds = allNewArticles.map((a) => a.id);
    const existingUnscoredIds = getUnscoredNewArticleIds(db);
    const allIds = [...new Set([...newIds, ...existingUnscoredIds])];

    if (allIds.length > 0) {
      logger.info(`Scoring ${allIds.length} articles with Haiku (${newIds.length} new, ${existingUnscoredIds.length} previously unscored)...`);
      const filterResult = await filterNewArticles(allIds, db);

      result.scoring = {
        scored: filterResult.results.length,
        hotCount: filterResult.hotCount,
        otherCount: filterResult.otherCount,
        dismissedCount: filterResult.dismissedCount,
        totalTokensIn: filterResult.totalTokensIn,
        totalTokensOut: filterResult.totalTokensOut,
        estimatedCostUsd: filterResult.estimatedCostUsd,
      };

      logger.info(
        `Scoring complete: ${filterResult.hotCount} hot, ${filterResult.otherCount} other, ${filterResult.dismissedCount} dismissed — $${filterResult.estimatedCostUsd.toFixed(4)}`
      );
    }
  }

  logger.info(
    `Fetch complete: ${result.newArticles} new, ${result.duplicatesSkipped} duplicates, ${result.errors.length} errors`
  );

  return result;
}

async function fetchSingleSource(source: Source): Promise<FeedItem[]> {
  logger.debug(`Fetching ${source.name} (${source.url})`);
  return fetchFeed(source.url);
}

async function extractOgImagesWithConcurrency(
  articles: NewArticleRef[],
  concurrency: number,
  db?: Database.Database,
): Promise<void> {
  let index = 0;

  async function worker(): Promise<void> {
    while (index < articles.length) {
      const current = articles[index++]!;
      const ogUrl = await extractOgImageUrl(current.url);
      if (ogUrl) {
        updateOgImage(current.id, ogUrl, db);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, articles.length) }, () => worker());
  await Promise.all(workers);
}

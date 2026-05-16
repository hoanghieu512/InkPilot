import { createLogger } from '../utils/logger.js';
import { getArticleById } from '../database/articles.js';
import { getDb } from '../database/index.js';
import { getUnscoredArticleIds, insertFilterResult } from '../database/filter-results.js';
import { updateArticleState } from '../database/article-states.js';
import { scoreArticles } from './haiku-filter.js';
import { SCORE_THRESHOLDS } from '../config/index.js';
import type { ArticleToScore, BatchFilterResult } from './types.js';
import type { Source } from '../database/types.js';
import type Database from 'better-sqlite3';

const logger = createLogger('content-filter');

const BATCH_SIZE = 10;

export async function filterNewArticles(
  articleIds: number[],
  db?: Database.Database,
): Promise<BatchFilterResult> {
  const unscoredIds = getUnscoredArticleIds(articleIds, db);

  if (unscoredIds.length === 0) {
    logger.info('All articles already scored — skipping');
    return { results: [], totalTokensIn: 0, totalTokensOut: 0, estimatedCostUsd: 0, hotCount: 0, otherCount: 0, dismissedCount: 0 };
  }

  logger.info(`Scoring ${unscoredIds.length} unscored articles (${Math.ceil(unscoredIds.length / BATCH_SIZE)} batch(es))...`);

  const sourceCache = new Map<number, Source>();
  const articlesToScore: ArticleToScore[] = [];

  for (const id of unscoredIds) {
    const article = getArticleById(id, db);
    if (!article) continue;

    let source: Source | undefined;
    if (article.source_id != null) {
      if (sourceCache.has(article.source_id)) {
        source = sourceCache.get(article.source_id);
      } else {
        const found = getSourceById(article.source_id, db);
        if (found) {
          sourceCache.set(article.source_id, found);
          source = found;
        }
      }
    }

    articlesToScore.push({
      id: article.id,
      title: article.title,
      contentSnippet: article.content,
      sourceSlug: source?.slug ?? 'unknown',
      sourceName: source?.name ?? 'Unknown',
      language: source?.language ?? 'en',
      publishedAt: article.published_at,
    });
  }

  const aggregated: BatchFilterResult = {
    results: [],
    totalTokensIn: 0,
    totalTokensOut: 0,
    estimatedCostUsd: 0,
    hotCount: 0,
    otherCount: 0,
    dismissedCount: 0,
  };

  for (let i = 0; i < articlesToScore.length; i += BATCH_SIZE) {
    const batch = articlesToScore.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(articlesToScore.length / BATCH_SIZE);
    logger.info(`Batch ${batchNum}/${totalBatches}: scoring ${batch.length} articles...`);

    const batchResult = await scoreArticles(batch);

    for (const result of batchResult.results) {
      insertFilterResult(result, db);

      if (result.score < SCORE_THRESHOLDS.OTHER_MIN) {
        updateArticleState(result.articleId, 'dismissed', db);
        aggregated.dismissedCount++;
      } else if (result.score >= SCORE_THRESHOLDS.HOT) {
        aggregated.hotCount++;
      } else {
        aggregated.otherCount++;
      }

      aggregated.results.push(result);
    }

    aggregated.totalTokensIn += batchResult.totalTokensIn;
    aggregated.totalTokensOut += batchResult.totalTokensOut;
    aggregated.estimatedCostUsd += batchResult.estimatedCostUsd;
  }

  logger.info(
    `Scoring complete: ${aggregated.hotCount} hot, ${aggregated.otherCount} other, ${aggregated.dismissedCount} dismissed`
  );

  return aggregated;
}

function getSourceById(sourceId: number, db?: Database.Database): Source | undefined {
  const conn = db ?? getDb();
  return conn.prepare('SELECT * FROM sources WHERE id = ?').get(sourceId) as Source | undefined;
}

export function getUnscoredNewArticleIds(db?: Database.Database): number[] {
  const conn = db ?? getDb();
  const rows = conn.prepare(`
    SELECT a.id FROM articles a
    JOIN article_states ast ON a.id = ast.article_id
    LEFT JOIN filter_results fr ON a.id = fr.article_id
    WHERE ast.state = 'new' AND fr.id IS NULL
  `).all() as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

export type { BatchFilterResult } from './types.js';

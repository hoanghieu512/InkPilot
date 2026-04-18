import { createLogger } from '../utils/logger.js';
import { getDb } from '../database/index.js';
import { getArticleById } from '../database/articles.js';
import { getFilterResult, getCachedBrief, cacheArticleBrief } from '../database/filter-results.js';
import { generateBriefWithSonnet, loadUserContext } from './sonnet-briefer.js';
import { exportAngleFile } from './angle-exporter.js';
import type { Brief, RelatedArticle } from './types.js';
import type { Source } from '../database/types.js';
import type Database from 'better-sqlite3';

const logger = createLogger('research-briefer');

interface RelatedArticleRow {
  id: number;
  title: string;
  url: string;
  published_at: string;
  source_slug: string;
  source_name: string;
  score: number;
}

function queryRelatedArticles(articleId: number, category: string | null, title: string, db: Database.Database): RelatedArticle[] {
  const titleWords = title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 5);

  const likeClauses = titleWords.map(() => 'LOWER(a.title) LIKE ?');

  const categoryCondition = category ? 'fr.category = ?' : '1=0';
  const matchCondition = likeClauses.length > 0 ? likeClauses.join(' OR ') : '1=0';

  const sql = `
    SELECT a.id, a.title, a.url, a.published_at,
           s.slug as source_slug, s.name as source_name,
           fr.score
    FROM articles a
    JOIN filter_results fr ON a.id = fr.article_id
    JOIN article_states ast ON a.id = ast.article_id
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE a.id != ?
      AND COALESCE(a.published_at, a.fetched_at) >= datetime('now', '-7 days')
      AND fr.score >= 6
      AND ast.state != 'dismissed'
      AND (${categoryCondition} OR ${matchCondition})
    ORDER BY fr.score DESC
    LIMIT 5
  `;

  const params: unknown[] = [articleId];
  if (category) params.push(category);
  for (const w of titleWords) params.push(`%${w}%`);

  const rows = db.prepare(sql).all(...params) as RelatedArticleRow[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    sourceSlug: r.source_slug ?? 'unknown',
    sourceName: r.source_name ?? 'Unknown',
    publishedAt: r.published_at ?? '',
    score: r.score,
  }));
}

function tryExportAngleFile(brief: Brief): Brief {
  try {
    const filePath = exportAngleFile(brief);
    logger.info(`Angle file saved: ${filePath}`);
    return { ...brief, savedAnglePath: filePath };
  } catch (err) {
    logger.warn('Could not save angle file', { error: String(err) });
    return brief;
  }
}

export interface GenerateBriefOptions {
  forceRefresh?: boolean;
}

export async function generateBrief(
  articleId: number,
  options: GenerateBriefOptions = {},
): Promise<Brief> {
  const db = getDb();

  const article = getArticleById(articleId, db);
  if (!article) {
    throw new Error(`Article #${articleId} not found. Run \`npm run list\` to see available articles.`);
  }

  const filterResult = getFilterResult(articleId, db);
  if (!filterResult) {
    throw new Error(`Article #${articleId} has not been scored yet. Run \`npm run fetch\` first.`);
  }

  if (!options.forceRefresh) {
    const cached = getCachedBrief(articleId, db);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as Omit<Brief, 'cached'>;
        logger.info(`Returning cached brief for article #${articleId}`);
        const brief: Brief = { ...parsed, cached: true };
        return tryExportAngleFile(brief);
      } catch {
        logger.warn('Failed to parse cached brief — regenerating');
      }
    }
  } else {
    logger.info(`Force refresh requested for article #${articleId} — skipping cache`);
  }

  const source = article.source_id != null
    ? db.prepare('SELECT * FROM sources WHERE id = ?').get(article.source_id) as Source | undefined
    : undefined;

  const sourceName = source?.name ?? 'Unknown';
  const sourceSlug = source?.slug ?? 'unknown';

  const relatedArticles = queryRelatedArticles(articleId, filterResult.category, article.title, db);
  logger.info(`Found ${relatedArticles.length} related articles`);

  const userContext = loadUserContext();

  const brief = await generateBriefWithSonnet(
    article,
    filterResult,
    sourceName,
    sourceSlug,
    relatedArticles,
    userContext,
  );

  const briefSucceeded = brief.tokensIn != null && brief.tokensIn > 0;
  if (briefSucceeded) {
    const briefToCache: Omit<Brief, 'cached'> = { ...brief };
    try {
      cacheArticleBrief(articleId, JSON.stringify(briefToCache), db);
      logger.info('Brief cached in filter_results.ai_context');
    } catch (err) {
      logger.warn('Failed to cache brief', { error: String(err) });
    }
  } else {
    logger.warn('Brief generation failed — not caching error result');
  }

  return tryExportAngleFile({ ...brief, cached: false });
}

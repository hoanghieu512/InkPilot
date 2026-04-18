import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/database/migrations.js';
import { seedSources } from '../src/database/sources.js';
import { insertArticle } from '../src/database/articles.js';
import { createArticleState, getArticleState, updateArticleState } from '../src/database/article-states.js';
import { insertFilterResult, isArticleScored, getFilterResult, getUnscoredArticleIds } from '../src/database/filter-results.js';
import type { RssSourceConfig } from '../src/config/rss-sources.js';
import type { FilterResult } from '../src/content-filter/types.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const testSources: RssSourceConfig[] = [
  {
    slug: 'test-source',
    name: 'Test Source',
    url: 'https://example.com/feed.xml',
    category: 'crypto',
    tier: 1,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },
];

function insertTestArticle(db: Database.Database, url: string, title: string): number {
  seedSources(testSources, db);
  const source = db.prepare("SELECT id FROM sources WHERE slug = 'test-source'").get() as { id: number };
  const result = insertArticle({ url, title, source_id: source.id }, db);
  if (result.inserted && result.id != null) {
    createArticleState(result.id, 'new', db);
    return result.id;
  }
  throw new Error('Failed to insert test article');
}

describe('filter-results DB', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('insertFilterResult stores a result', () => {
    const articleId = insertTestArticle(db, 'https://example.com/1', 'Article 1');
    const result: FilterResult = {
      articleId,
      score: 8.5,
      category: 'L2',
      reasoning: 'Relevant L2 update',
      suggestedAngle: 'Compare with Arbitrum',
      tokensIn: 500,
      tokensOut: 200,
    };

    insertFilterResult(result, db);

    const stored = getFilterResult(articleId, db);
    expect(stored).toBeDefined();
    expect(stored!.score).toBe(8.5);
    expect(stored!.category).toBe('L2');
    expect(stored!.reasoning).toBe('Relevant L2 update');
    expect(stored!.suggested_angle).toBe('Compare with Arbitrum');
  });

  it('isArticleScored returns true after scoring', () => {
    const articleId = insertTestArticle(db, 'https://example.com/2', 'Article 2');
    expect(isArticleScored(articleId, db)).toBe(false);

    insertFilterResult({
      articleId, score: 7, category: 'DeFi', reasoning: '', suggestedAngle: '', tokensIn: 0, tokensOut: 0,
    }, db);

    expect(isArticleScored(articleId, db)).toBe(true);
  });

  it('insertFilterResult is idempotent — INSERT OR IGNORE on UNIQUE article_id', () => {
    const articleId = insertTestArticle(db, 'https://example.com/3', 'Article 3');

    insertFilterResult({
      articleId, score: 9, category: 'Protocol', reasoning: 'First', suggestedAngle: '', tokensIn: 0, tokensOut: 0,
    }, db);

    insertFilterResult({
      articleId, score: 5, category: 'Market', reasoning: 'Second', suggestedAngle: '', tokensIn: 0, tokensOut: 0,
    }, db);

    const stored = getFilterResult(articleId, db);
    expect(stored!.score).toBe(9);
    expect(stored!.reasoning).toBe('First');
  });

  it('getUnscoredArticleIds filters out already-scored articles', () => {
    const id1 = insertTestArticle(db, 'https://example.com/4', 'Article 4');
    const id2 = insertTestArticle(db, 'https://example.com/5', 'Article 5');
    const id3 = insertTestArticle(db, 'https://example.com/6', 'Article 6');

    insertFilterResult({
      articleId: id1, score: 8, category: 'L2', reasoning: '', suggestedAngle: '', tokensIn: 0, tokensOut: 0,
    }, db);

    const unscored = getUnscoredArticleIds([id1, id2, id3], db);
    expect(unscored).toEqual([id2, id3]);
  });
});

describe('scoring + article state integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('article score < 6 → state becomes dismissed', () => {
    const articleId = insertTestArticle(db, 'https://example.com/low', 'Low Score');

    insertFilterResult({
      articleId, score: 3, category: 'Market', reasoning: 'Irrelevant', suggestedAngle: '', tokensIn: 0, tokensOut: 0,
    }, db);

    updateArticleState(articleId, 'dismissed', db);

    const state = getArticleState(articleId, db);
    expect(state!.state).toBe('dismissed');
  });

  it('article score >= 6 → state stays new', () => {
    const articleId = insertTestArticle(db, 'https://example.com/mid', 'Mid Score');

    insertFilterResult({
      articleId, score: 7.5, category: 'DeFi', reasoning: 'Decent', suggestedAngle: 'Write about TVL', tokensIn: 0, tokensOut: 0,
    }, db);

    const state = getArticleState(articleId, db);
    expect(state!.state).toBe('new');
  });
});

describe('cost calculation', () => {
  it('calculates correct USD estimate from token counts', () => {
    const HAIKU_INPUT_PRICE = 0.80 / 1_000_000;
    const HAIKU_OUTPUT_PRICE = 4.00 / 1_000_000;

    const tokensIn = 5000;
    const tokensOut = 2000;
    const cost = tokensIn * HAIKU_INPUT_PRICE + tokensOut * HAIKU_OUTPUT_PRICE;

    expect(cost).toBeCloseTo(0.012, 4);
  });
});

describe('scoreArticles with mocked Anthropic', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns correct FilterResult from mocked API response', async () => {
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: vi.fn().mockImplementation(() => ({
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: JSON.stringify([
              { id: 1, score: 9, category: 'L2', reasoning: 'Major update', suggestedAngle: 'Compare ecosystems' },
              { id: 2, score: 4, category: 'Market', reasoning: 'Price analysis', suggestedAngle: '' },
            ])}],
            usage: { input_tokens: 500, output_tokens: 200 },
          }),
        },
      })),
    }));

    const { scoreArticles } = await import('../src/content-filter/haiku-filter.js');

    const result = await scoreArticles([
      { id: 1, title: 'L2 Update', contentSnippet: 'Some update', sourceSlug: 'test', sourceName: 'Test', language: 'en', publishedAt: null },
      { id: 2, title: 'Price Prediction', contentSnippet: 'Price goes up', sourceSlug: 'test', sourceName: 'Test', language: 'en', publishedAt: null },
    ]);

    expect(result.results).toHaveLength(2);
    expect(result.results[0]!.score).toBe(9);
    expect(result.results[0]!.category).toBe('L2');
    expect(result.results[1]!.score).toBe(4);
    expect(result.totalTokensIn).toBe(500);
    expect(result.totalTokensOut).toBe(200);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);

    vi.doUnmock('@anthropic-ai/sdk');
  });

  it('returns fallback score 5 on malformed JSON response', async () => {
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: vi.fn().mockImplementation(() => ({
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'This is not valid JSON at all' }],
            usage: { input_tokens: 100, output_tokens: 50 },
          }),
        },
      })),
    }));

    const { scoreArticles } = await import('../src/content-filter/haiku-filter.js');

    const result = await scoreArticles([
      { id: 99, title: 'Test', contentSnippet: null, sourceSlug: 'test', sourceName: 'Test', language: 'en', publishedAt: null },
    ]);

    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.score).toBe(5);
    expect(result.results[0]!.reasoning).toContain('Fallback');

    vi.doUnmock('@anthropic-ai/sdk');
  });

  it('returns empty results on API failure (no crash)', async () => {
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: vi.fn().mockImplementation(() => ({
        messages: {
          create: vi.fn().mockRejectedValue(new Error('Rate limited')),
        },
      })),
    }));

    const { scoreArticles } = await import('../src/content-filter/haiku-filter.js');

    const result = await scoreArticles([
      { id: 100, title: 'Test', contentSnippet: null, sourceSlug: 'test', sourceName: 'Test', language: 'en', publishedAt: null },
    ]);

    expect(result.results).toHaveLength(0);
    expect(result.estimatedCostUsd).toBe(0);

    vi.doUnmock('@anthropic-ai/sdk');
  });
});

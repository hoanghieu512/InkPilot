import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/database/migrations.js';
import { seedSources } from '../src/database/sources.js';
import { insertArticle } from '../src/database/articles.js';
import { createArticleState } from '../src/database/article-states.js';
import { insertFilterResult, getCachedBrief, cacheArticleBrief } from '../src/database/filter-results.js';
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
    slug: 'bankless',
    name: 'Bankless',
    url: 'https://bankless.com/feed',
    category: 'crypto',
    tier: 1,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },
];

function insertScoredArticle(
  db: Database.Database,
  url: string,
  title: string,
  score: number,
  opts?: { publishedAt?: string; category?: string },
): number {
  seedSources(testSources, db);
  const source = db.prepare("SELECT id FROM sources WHERE slug = 'bankless'").get() as { id: number };
  const result = insertArticle({
    url,
    title,
    source_id: source.id,
    published_at: opts?.publishedAt ?? new Date().toISOString(),
    content: 'Test article content snippet',
  }, db);
  if (!result.inserted || result.id == null) throw new Error('Failed to insert test article');

  createArticleState(result.id, 'new', db);

  const filterResult: FilterResult = {
    articleId: result.id,
    score,
    category: opts?.category ?? 'L2',
    reasoning: 'Test reasoning',
    suggestedAngle: 'Test angle',
    tokensIn: 100,
    tokensOut: 50,
  };
  insertFilterResult(filterResult, db);

  return result.id;
}

describe('filter-results cache', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('getCachedBrief returns null when no cache exists', () => {
    const id = insertScoredArticle(db, 'https://example.com/1', 'Article 1', 9);
    expect(getCachedBrief(id, db)).toBeNull();
  });

  it('cacheArticleBrief stores and getCachedBrief retrieves', () => {
    const id = insertScoredArticle(db, 'https://example.com/2', 'Article 2', 8.5);
    const briefJson = JSON.stringify({ whyItMatters: 'test', suggestedAngles: { vietnamese: [], english: [] } });

    cacheArticleBrief(id, briefJson, db);

    const cached = getCachedBrief(id, db);
    expect(cached).toBe(briefJson);

    const parsed = JSON.parse(cached!);
    expect(parsed.whyItMatters).toBe('test');
  });
});

describe('related articles query', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('only returns articles within 7 days, score >= 6, not dismissed', () => {
    const recentHighScore = insertScoredArticle(db, 'https://example.com/recent-high', 'Polymarket V2', 9, {
      publishedAt: new Date().toISOString(),
      category: 'DeFi',
    });

    insertScoredArticle(db, 'https://example.com/recent-low', 'Low Score Article', 3, {
      publishedAt: new Date().toISOString(),
      category: 'DeFi',
    });

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 30);
    insertScoredArticle(db, 'https://example.com/old-high', 'Old High Score', 9, {
      publishedAt: oldDate.toISOString(),
      category: 'DeFi',
    });

    const rows = db.prepare(`
      SELECT a.id, a.title, a.published_at, fr.score, fr.category, ast.state
      FROM articles a
      JOIN filter_results fr ON a.id = fr.article_id
      JOIN article_states ast ON a.id = ast.article_id
      WHERE a.id != ?
        AND COALESCE(a.published_at, a.fetched_at) >= datetime('now', '-7 days')
        AND fr.score >= 6
        AND ast.state != 'dismissed'
      ORDER BY fr.score DESC
      LIMIT 5
    `).all(recentHighScore) as Array<{ id: number; title: string; score: number }>;

    expect(rows.every((r) => r.score >= 6)).toBe(true);
    expect(rows.every((r) => r.id !== recentHighScore)).toBe(true);
    const oldIds = rows.filter((r) => r.title === 'Old High Score');
    expect(oldIds).toHaveLength(0);
  });
});

describe('generateBrief with mocked Sonnet', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns valid Brief from mocked API response', async () => {
    const mockResponse = {
      whyItMatters: 'Polymarket V2 introduces custom stablecoin on Base L2.',
      suggestedAngles: {
        vietnamese: ['Angle VN 1', 'Angle VN 2'],
        english: ['Angle EN 1'],
      },
    };

    vi.doMock('@anthropic-ai/sdk', () => ({
      default: vi.fn().mockImplementation(() => ({
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: JSON.stringify(mockResponse) }],
            usage: { input_tokens: 1200, output_tokens: 380 },
          }),
        },
      })),
    }));

    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        readFileSync: vi.fn().mockImplementation((p: string) => {
          if (typeof p === 'string' && p.includes('about-me')) return '# About Me\nCrypto researcher';
          if (typeof p === 'string' && p.includes('tone-guidelines')) return '# Tone\nDirect, data-backed';
          return actual.readFileSync(p, 'utf-8');
        }),
      };
    });

    const { generateBriefWithSonnet, loadUserContext } = await import('../src/research-briefer/sonnet-briefer.js');

    const userContext = loadUserContext();
    expect(userContext).toContain('About');

    const article = {
      id: 1, url: 'https://example.com/polymarket', title: 'Polymarket V2',
      content: 'Test content', summary: null, author: null,
      published_at: new Date().toISOString(), source_id: 1,
      og_image_url: null, fetched_at: new Date().toISOString(), raw_data: null,
    };

    const filterResult = {
      id: 1, article_id: 1, score: 9, category: 'DeFi', reasoning: 'Major update',
      suggested_angle: 'Compare markets', ai_context: null, model: 'haiku',
      input_tokens: 500, output_tokens: 200, scored_at: new Date().toISOString(),
    };

    const result = await generateBriefWithSonnet(article, filterResult, 'Bankless', 'bankless', [], userContext);

    expect(result.articleId).toBe(1);
    expect(result.whyItMatters).toContain('Polymarket');
    expect(result.suggestedAngles.vietnamese).toHaveLength(2);
    expect(result.suggestedAngles.english).toHaveLength(1);
    expect(result.tokensIn).toBe(1200);
    expect(result.tokensOut).toBe(380);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);

    vi.doUnmock('@anthropic-ai/sdk');
    vi.doUnmock('fs');
  });

  it('returns partial brief on Sonnet API failure (no crash)', async () => {
    vi.doMock('@anthropic-ai/sdk', () => ({
      default: vi.fn().mockImplementation(() => ({
        messages: {
          create: vi.fn().mockRejectedValue(new Error('API key invalid')),
        },
      })),
    }));

    const { generateBriefWithSonnet } = await import('../src/research-briefer/sonnet-briefer.js');

    const article = {
      id: 2, url: 'https://example.com/fail', title: 'Fail Article',
      content: null, summary: null, author: null,
      published_at: null, source_id: null,
      og_image_url: null, fetched_at: new Date().toISOString(), raw_data: null,
    };

    const filterResult = {
      id: 2, article_id: 2, score: 8, category: 'L2', reasoning: 'Test',
      suggested_angle: null, ai_context: null, model: 'haiku',
      input_tokens: 0, output_tokens: 0, scored_at: new Date().toISOString(),
    };

    const result = await generateBriefWithSonnet(article, filterResult, 'Test', 'test', [], '');

    expect(result.whyItMatters).toContain('failed');
    expect(result.suggestedAngles.vietnamese).toHaveLength(0);
    expect(result.suggestedAngles.english).toHaveLength(0);
    expect(result.tokensIn).toBeUndefined();

    vi.doUnmock('@anthropic-ai/sdk');
  });

  it('user context files not found — falls back gracefully', async () => {
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return {
        ...actual,
        readFileSync: vi.fn().mockImplementation((p: string, enc?: string) => {
          if (typeof p === 'string' && (p.includes('about-me') || p.includes('tone-guidelines'))) {
            throw new Error('ENOENT');
          }
          return actual.readFileSync(p, enc as BufferEncoding);
        }),
      };
    });

    const { loadUserContext } = await import('../src/research-briefer/sonnet-briefer.js');

    const context = loadUserContext();
    expect(context).toBe('');

    vi.doUnmock('fs');
  });
});

describe('Sonnet cost calculation', () => {
  it('calculates correct USD estimate from token counts', () => {
    const SONNET_INPUT_PRICE = 3.00 / 1_000_000;
    const SONNET_OUTPUT_PRICE = 15.00 / 1_000_000;

    const tokensIn = 1200;
    const tokensOut = 380;
    const cost = tokensIn * SONNET_INPUT_PRICE + tokensOut * SONNET_OUTPUT_PRICE;

    expect(cost).toBeCloseTo(0.0093, 4);
  });
});

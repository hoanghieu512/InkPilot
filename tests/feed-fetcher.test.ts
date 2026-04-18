import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../src/database/migrations.js';
import { seedSources, getAllSources, getSourceBySlug, getEnabledSources } from '../src/database/sources.js';
import { insertArticle, getArticleById, getArticlesToday } from '../src/database/articles.js';
import { createArticleState, getArticleState, updateArticleState } from '../src/database/article-states.js';
import type { RssSourceConfig } from '../src/config/rss-sources.js';
import type { ArticleState } from '../src/database/types.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const testSources: RssSourceConfig[] = [
  {
    slug: 'test-source-1',
    name: 'Test Source 1',
    url: 'https://example.com/feed1.xml',
    category: 'crypto',
    tier: 1,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },
  {
    slug: 'test-source-2',
    name: 'Test Source 2',
    url: 'https://example.com/feed2.xml',
    category: 'defi',
    tier: 2,
    fetchIntervalHours: 2,
    enabled: false,
    language: 'vi',
  },
];

describe('Sources', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('seedSources inserts sources', () => {
    seedSources(testSources, db);
    const all = getAllSources(db);
    expect(all).toHaveLength(2);
    expect(all[0]!.slug).toBe('test-source-1');
    expect(all[1]!.slug).toBe('test-source-2');
  });

  it('seedSources is idempotent — calling twice does not create duplicates', () => {
    seedSources(testSources, db);
    seedSources(testSources, db);
    const all = getAllSources(db);
    expect(all).toHaveLength(2);
  });

  it('getEnabledSources returns only enabled sources', () => {
    seedSources(testSources, db);
    const enabled = getEnabledSources(db);
    expect(enabled).toHaveLength(1);
    expect(enabled[0]!.slug).toBe('test-source-1');
  });

  it('getSourceBySlug returns correct source', () => {
    seedSources(testSources, db);
    const source = getSourceBySlug('test-source-2', db);
    expect(source).toBeDefined();
    expect(source!.name).toBe('Test Source 2');
    expect(source!.language).toBe('vi');
  });

  it('getSourceBySlug returns undefined for non-existent slug', () => {
    expect(getSourceBySlug('nonexistent', db)).toBeUndefined();
  });
});

describe('Articles', () => {
  let db: Database.Database;
  let sourceId: number;

  beforeEach(() => {
    db = createTestDb();
    seedSources(testSources, db);
    const source = getSourceBySlug('test-source-1', db)!;
    sourceId = source.id;
  });

  it('insertArticle inserts a new article', () => {
    const result = insertArticle({
      url: 'https://example.com/article-1',
      title: 'Test Article 1',
      source_id: sourceId,
      published_at: new Date().toISOString(),
    }, db);

    expect(result.inserted).toBe(true);
    expect(result.id).toBeGreaterThan(0);
  });

  it('insertArticle dedup — same URL returns inserted: false', () => {
    const first = insertArticle({
      url: 'https://example.com/article-dup',
      title: 'First Insert',
      source_id: sourceId,
    }, db);
    expect(first.inserted).toBe(true);

    const second = insertArticle({
      url: 'https://example.com/article-dup',
      title: 'Second Insert',
      source_id: sourceId,
    }, db);
    expect(second.inserted).toBe(false);
    expect(second.id).toBeUndefined();
  });

  it('getArticleById returns the correct article', () => {
    const result = insertArticle({
      url: 'https://example.com/article-get',
      title: 'Get Me',
      author: 'Test Author',
      source_id: sourceId,
    }, db);

    const article = getArticleById(result.id!, db);
    expect(article).toBeDefined();
    expect(article!.title).toBe('Get Me');
    expect(article!.author).toBe('Test Author');
  });

  it('getArticlesToday returns recent articles', () => {
    insertArticle({
      url: 'https://example.com/today-1',
      title: 'Today Article',
      source_id: sourceId,
    }, db);

    const today = getArticlesToday(50, db);
    expect(today).toHaveLength(1);
    expect(today[0]!.title).toBe('Today Article');
  });
});

describe('Article States', () => {
  let db: Database.Database;
  let articleId: number;

  beforeEach(() => {
    db = createTestDb();
    seedSources(testSources, db);
    const source = getSourceBySlug('test-source-1', db)!;
    const result = insertArticle({
      url: 'https://example.com/state-test',
      title: 'State Test',
      source_id: source.id,
    }, db);
    articleId = result.id!;
  });

  it('createArticleState creates a state row with default "new"', () => {
    createArticleState(articleId, 'new', db);
    const state = getArticleState(articleId, db);
    expect(state).toBeDefined();
    expect(state!.state).toBe('new');
  });

  it('updateArticleState changes the state', () => {
    createArticleState(articleId, 'new', db);
    updateArticleState(articleId, 'starred', db);
    const state = getArticleState(articleId, db);
    expect(state!.state).toBe('starred');
  });

  it('createArticleState is idempotent — INSERT OR IGNORE', () => {
    createArticleState(articleId, 'new', db);
    createArticleState(articleId, 'read', db);
    const state = getArticleState(articleId, db);
    expect(state!.state).toBe('new');
  });
});

describe('OG Extractor', () => {
  it('returns null on network error (never throws)', async () => {
    const { extractOgImageUrl } = await import('../src/feed-fetcher/og-extractor.js');
    const result = await extractOgImageUrl('https://this-domain-does-not-exist-12345.example');
    expect(result).toBeNull();
  });
});

describe('runFetch integration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    seedSources(testSources, db);
  });

  it('handles feed errors gracefully — partial failure', async () => {
    const { runFetch } = await import('../src/feed-fetcher/index.js');
    const rssParser = await import('../src/feed-fetcher/rss-parser.js');

    const originalFetchFeed = rssParser.fetchFeed;
    vi.spyOn(rssParser, 'fetchFeed').mockImplementation(async (url: string) => {
      if (url.includes('feed1')) {
        return [
          { url: 'https://example.com/a1', title: 'Article 1', publishedAt: new Date().toISOString(), contentSnippet: 'Snippet 1', author: null },
          { url: 'https://example.com/a2', title: 'Article 2', publishedAt: new Date().toISOString(), contentSnippet: 'Snippet 2', author: 'Author 2' },
        ];
      }
      throw new Error('Feed timeout');
    });

    const ogExtractor = await import('../src/feed-fetcher/og-extractor.js');
    vi.spyOn(ogExtractor, 'extractOgImageUrl').mockResolvedValue(null);

    const result = await runFetch(db);

    expect(result.sourcesChecked).toBe(1);
    expect(result.newArticles).toBe(2);
    expect(result.errors).toHaveLength(0);

    const a1 = db.prepare("SELECT * FROM articles WHERE url = 'https://example.com/a1'").get() as Record<string, unknown> | undefined;
    expect(a1).toBeDefined();
    expect(a1!['title']).toBe('Article 1');

    const states = db.prepare('SELECT * FROM article_states').all();
    expect(states).toHaveLength(2);

    vi.restoreAllMocks();
  });
});

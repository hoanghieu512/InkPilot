import type Database from 'better-sqlite3';
import { getDb } from './index.js';
import type { Source } from './types.js';
import type { RssSourceConfig } from '../config/rss-sources.js';

export function seedSources(sources: RssSourceConfig[], db?: Database.Database): void {
  const conn = db ?? getDb();
  const stmt = conn.prepare(`
    INSERT INTO sources (slug, name, url, category, tier, fetch_interval_minutes, enabled, language)
    VALUES (@slug, @name, @url, @category, @tier, @fetch_interval_minutes, @enabled, @language)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      url = excluded.url,
      category = excluded.category,
      tier = excluded.tier,
      fetch_interval_minutes = excluded.fetch_interval_minutes,
      enabled = excluded.enabled,
      language = excluded.language
  `);

  const upsert = conn.transaction((items: RssSourceConfig[]) => {
    for (const s of items) {
      stmt.run({
        slug: s.slug,
        name: s.name,
        url: s.url,
        category: s.category,
        tier: s.tier,
        fetch_interval_minutes: s.fetchIntervalHours * 60,
        enabled: s.enabled ? 1 : 0,
        language: s.language,
      });
    }
  });

  upsert(sources);
}

export function getAllSources(db?: Database.Database): Source[] {
  const conn = db ?? getDb();
  return conn.prepare('SELECT * FROM sources ORDER BY tier, name').all() as Source[];
}

export function getEnabledSources(db?: Database.Database): Source[] {
  const conn = db ?? getDb();
  return conn.prepare('SELECT * FROM sources WHERE enabled = 1 ORDER BY tier, name').all() as Source[];
}

export function getSourceBySlug(slug: string, db?: Database.Database): Source | undefined {
  const conn = db ?? getDb();
  return conn.prepare('SELECT * FROM sources WHERE slug = ?').get(slug) as Source | undefined;
}

export function updateLastFetchedAt(sourceId: number, db?: Database.Database): void {
  const conn = db ?? getDb();
  conn.prepare("UPDATE sources SET last_fetched_at = datetime('now') WHERE id = ?").run(sourceId);
}

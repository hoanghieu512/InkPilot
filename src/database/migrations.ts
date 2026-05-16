import type Database from 'better-sqlite3';
import { CREATE_TABLES } from './schema.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('database:migrations');

export function runMigrations(db: Database.Database): void {
  migrateSourcesTable(db);
  migrateFilterResultsTable(db);
  migrateSourcesCategoryConstraint(db);
  db.exec(CREATE_TABLES);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;

  logger.info(`Database initialized — ${tables.length} tables ready`, {
    tables: tables.map((t) => t.name).join(', '),
  });
}

/**
 * If the old sources table exists (without slug column), drop it so CREATE_TABLES
 * can recreate with the new schema. Safe because sources are re-seeded from config.
 */
/**
 * If old filter_results table exists without UNIQUE on article_id, recreate it.
 * Safe because scoring hasn't been done before this slice.
 */
function migrateFilterResultsTable(db: Database.Database): void {
  const indexInfo = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='filter_results'"
  ).get() as { sql: string } | undefined;
  if (!indexInfo) return;

  if (!indexInfo.sql.includes('UNIQUE')) {
    logger.info('Migrating filter_results table — adding UNIQUE on article_id');
    db.exec('DROP TABLE IF EXISTS filter_results');
  }
}

/** Drop sources table if its CHECK constraint predates protocol-l2 / research-technical categories. */
function migrateSourcesCategoryConstraint(db: Database.Database): void {
  const info = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='sources'"
  ).get() as { sql: string } | undefined;
  if (!info) return;

  if (!info.sql.includes('protocol-l2')) {
    logger.info('Migrating sources table — expanding category CHECK constraint');
    db.pragma('foreign_keys = OFF');
    db.exec('DROP TABLE IF EXISTS sources');
    db.pragma('foreign_keys = ON');
  }
}

function migrateSourcesTable(db: Database.Database): void {
  const tableInfo = db.pragma('table_info(sources)') as Array<{ name: string }>;
  if (tableInfo.length === 0) return;

  const hasSlug = tableInfo.some((col) => col.name === 'slug');
  if (!hasSlug) {
    logger.info('Migrating sources table — adding slug, tier, language columns');
    db.exec('DROP TABLE IF EXISTS sources');
  }
}

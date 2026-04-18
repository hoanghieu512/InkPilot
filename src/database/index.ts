import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runMigrations } from './migrations.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('database');

let dbInstance: Database.Database | null = null;

const DEFAULT_DB_PATH = path.join(os.homedir(), '.inkpilot', 'inkpilot.db');

export function initDb(dbPath?: string): Database.Database {
  if (dbInstance) return dbInstance;

  const resolvedPath = dbPath ?? DEFAULT_DB_PATH;
  const isMemory = resolvedPath === ':memory:';

  if (!isMemory) {
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info(`Created database directory: ${dir}`);
    }
  }

  dbInstance = new Database(resolvedPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  runMigrations(dbInstance);

  logger.info(`Database connected: ${isMemory ? ':memory:' : resolvedPath}`);
  return dbInstance;
}

export function getDb(): Database.Database {
  if (!dbInstance) {
    return initDb();
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    logger.debug('Database connection closed');
  }
}

/** Reset singleton — used in tests to allow fresh :memory: databases */
export function resetDb(): void {
  dbInstance = null;
}

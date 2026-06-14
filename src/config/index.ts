import dotenv from 'dotenv';
import path from 'node:path';
import os from 'node:os';
import type { Config } from './types.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env var: ${key}. See .env.example`);
  }
  return value;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export function requireTwitterApiIoKey(): string {
  const key = process.env['TWITTERAPI_IO_KEY'];
  if (!key) {
    throw new Error(
      'Missing required env var: TWITTERAPI_IO_KEY. Add it to .env (see .env.example). ' +
        'Get a key at https://twitterapi.io. Or pass --skip-enrich to run CSV-only.',
    );
  }
  return key;
}

/**
 * Max TwitterAPI.io requests/second for enrichment. Read from `TWITTERAPI_IO_QPS`.
 * Default is conservative (10) so a balance/QPS drop never overruns the limit;
 * raise it in .env if your account allows more. Never hardcode at the call site.
 */
export function getTwitterApiIoQps(): number {
  const raw = process.env['TWITTERAPI_IO_QPS'];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 10;
}

const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);

function resolveDbPath(raw: string): string {
  if (raw.startsWith('~')) {
    return path.join(os.homedir(), raw.slice(1));
  }
  return path.resolve(raw);
}

export function loadConfig(): Config {
  const logLevel = optionalEnv('LOG_LEVEL', 'info');
  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${logLevel}. Must be one of: debug, info, warn, error`);
  }

  return {
    anthropicApiKey: requireEnv('ANTHROPIC_API_KEY'),
    dbPath: resolveDbPath(optionalEnv('DB_PATH', '~/.inkpilot/inkpilot.db')),
    logLevel: logLevel as Config['logLevel'],
  };
}

export const AI_MODELS = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
} as const;

export const SCORE_THRESHOLDS = {
  HOT: 7.5,       // score >= HOT → shown in HOT tier
  OTHER_MIN: 6.0, // score >= OTHER_MIN → shown in OTHER tier; below → auto-dismissed
} as const;

export const REPLY_THRESHOLDS = {
  DUD_IMPRESSIONS: 50, // reply with impressions < this is a "dud"
} as const;

export type { Config };

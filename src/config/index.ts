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

export type { Config };

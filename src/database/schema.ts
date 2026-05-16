export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL CHECK(category IN ('crypto', 'tech', 'ai', 'protocol', 'defi', 'dev', 'vietnamese', 'protocol-l2', 'research-technical')),
  tier INTEGER NOT NULL DEFAULT 1,
  fetch_interval_minutes INTEGER NOT NULL DEFAULT 60,
  enabled INTEGER NOT NULL DEFAULT 1,
  language TEXT NOT NULL DEFAULT 'en',
  last_fetched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT,
  summary TEXT,
  author TEXT,
  published_at TEXT,
  source_id INTEGER REFERENCES sources(id),
  og_image_url TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  raw_data TEXT
);

CREATE TABLE IF NOT EXISTS filter_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL UNIQUE REFERENCES articles(id),
  score REAL NOT NULL,
  category TEXT,
  reasoning TEXT,
  suggested_angle TEXT,
  ai_context TEXT,
  model TEXT NOT NULL DEFAULT 'haiku',
  input_tokens INTEGER,
  output_tokens INTEGER,
  scored_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS article_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL UNIQUE REFERENCES articles(id),
  state TEXT NOT NULL DEFAULT 'new'
    CHECK(state IN ('new', 'read', 'starred', 'drafted', 'posted', 'dismissed')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER REFERENCES articles(id),
  platform TEXT NOT NULL DEFAULT 'x',
  content TEXT NOT NULL,
  byte_count INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id INTEGER REFERENCES drafts(id),
  article_id INTEGER REFERENCES articles(id),
  platform TEXT NOT NULL DEFAULT 'x',
  platform_post_id TEXT NOT NULL,
  platform_post_url TEXT,
  content_snapshot TEXT NOT NULL,
  posted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS post_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id),
  likes INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  recasts INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_article_states_state ON article_states(state);
CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts(posted_at);
CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform);
`;

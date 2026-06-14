# InkPilot — CLAUDE.md

CLI tool for crypto content research: scrape RSS → Haiku scoring → Sonnet brief → Obsidian vault export. No UI. User writes and publishes posts manually to X.

## Commands

```bash
npm run fetch                    # scrape RSS → dedup → OG → Haiku score
npm run fetch -- --verbose       # same + per-feed item/new/dup log
npm run list                     # tiered inbox: HOT (7.5+) then OTHER (6–7.4)
npm run list -- --hot            # HOT only
npm run list -- --other          # OTHER only (6–7.4)
npm run list -- --all            # all including dismissed
npm run list -- --days=7         # recency filter (default 30)
npm run brief <id>               # Sonnet brief → cache → export angle .md
npm run brief -- <id> --refresh  # skip cache, regenerate + overwrite
npm run reply:analyze            # X Analytics CSVs → enrich (TwitterAPI.io) → reply_tracking → snapshot JSON
npm run reply:analyze -- --skip-enrich           # CSV-only, no API spend
npm run reply:analyze -- --content=PATH --overview=PATH   # override CSV paths
npm run sources:status           # per-source health table (no API key needed)
npm run stats:scoring            # scoring histogram + HOT/OTHER/dismissed ratio (--days=N)
npm run stats:sources            # per-source HOT rate table (--days=N)
npm run inspect:near-hot         # score 7–7.4 articles + full Haiku reasoning (--limit=N --days=N)
npm test                         # vitest run — 71 tests, in-memory SQLite
```

## Architecture essentials

**DB is sync, HTTP+AI is async.** `better-sqlite3` is synchronous — no `await` on DB calls. All `async/await` is HTTP (RSS fetch, OG extraction) or Anthropic API calls only.

**All DB functions accept optional `db?` param.** This is the testability pattern: `function foo(x, db?: Database.Database)` — tests pass in-memory DB, production uses singleton `getDb()`. Never break this pattern.

**`rss-sources.ts` is the single source of truth for feeds.** Changes to URL/enabled/tier auto-sync to DB on next `npm run fetch` via `seedSources()` which uses `ON CONFLICT(slug) DO UPDATE`. Don't edit the DB directly for source config.

**`AI_MODELS` in `src/config/index.ts` is the single place to change model IDs.** Both `haiku-filter.ts` and `sonnet-briefer.ts` import from there.

**`SCORE_THRESHOLDS` in `src/config/index.ts` is the single place to change HOT/OTHER thresholds.** `HOT = 7.5`, `OTHER_MIN = 6.0`. All scripts (`list.ts`, `stats-scoring.ts`, `stats-sources.ts`, `inspect-near-hot.ts`) and `content-filter/` import from there. Never hardcode these values.

**Scoring is idempotent.** Articles already in `filter_results` are never re-scored. `getUnscoredNewArticleIds()` filters them out. Don't add logic that re-scores existing articles.

**Brief is cached in `filter_results.ai_context`.** Second `npm run brief <id>` returns from DB, no API call. `--refresh` flag bypasses this. After every brief (cached or not), `exportAngleFile` always runs and overwrites the vault `.md`.

**Graceful degradation everywhere.** OG extractor never throws. Feed failures via `Promise.allSettled` don't block other feeds. Haiku failure → articles stay `new`, scored next run. Sonnet failure → partial brief returned.

## Key files

| File | What it does |
|------|-------------|
| `src/config/rss-sources.ts` | Feed list — edit here to add/disable/change URL |
| `src/config/index.ts` | `AI_MODELS` + `SCORE_THRESHOLDS` + `.env` loader |
| `src/feed-fetcher/index.ts` | `runFetch(db?, skipScoring?, verbose?)` orchestrator |
| `src/content-filter/haiku-filter.ts` | Haiku batch scoring, fallback score 5 on parse failure |
| `src/research-briefer/sonnet-briefer.ts` | Sonnet brief + `loadUserContext()` |
| `src/research-briefer/angle-exporter.ts` | Fills `__KEY__` template → writes vault `.md` |
| `src/database/sources.ts` | `seedSources`, `getEnabledSources`, `getSourcesStatus` |
| `src/database/filter-results.ts` | `isArticleScored`, `cacheArticleBrief`, `getCachedBrief` |
| `src/database/index.ts` | `initDb` / `getDb` / `resetDb` (tests use `resetDb`) |
| `src/reply-tracking/index.ts` | `runReplyAnalyze` orchestrator — CSV → enrich → reply_tracking → snapshot |
| `src/config/kol-niches.ts` | KOL handle→niche map (synced by hand from vault `kol-reply-list.md`) |

## Current version: v0.5.0

## Current state

**9/16 sources enabled.** Enabled: Decrypt, Bankless, CoinDesk, Blockworks, ETH Research Forum, Bitcoin Optech, Ethereum Foundation Blog, Arbitrum Foundation, CoinCu News. Disabled: The Block + Base Blog (Cloudflare), Optimism Blog (stale since Jun 2025), Vitalik/Coin68/Tạp Chí Bitcoin/MarkTechPost (retained disabled for FK integrity — articles exist in DB).

**Planned but not built:** X API adapter (Slice 5), TUI/Ink (Slice 6). The `posts`, `drafts`, `post_metrics` tables exist in schema but have no adapter yet.

**User context files** read at runtime from `~/Dev/projects/Content-Creator/about-me.md` and `tone-guidelines.md`. Missing files → graceful fallback, brief still generated.

**Vault template** at `~/Dev/vault/templates/angle-template.md` — uses `__KEY__` placeholders (not `{{}}`, YAML-safe). Output goes to `~/Dev/vault/projects/content-creator/angles/YYYY-MM-DD-<id>-<slug>.md`.

**Reply tracking** added in v0.5.0. `reply_tracking` table accumulates KOL-reply history across weeks, keyed by reply tweet id (`post_id`, UNIQUE) — re-running the same CSV is idempotent. `npm run reply:analyze` reads X Analytics CSVs from `~/Dev/vault/projects/content-creator/analytics/raw/{content,overview}-latest.csv`, enriches via TwitterAPI.io (`TWITTERAPI_IO_KEY`), and writes a fixed-schema snapshot to `~/Dev/vault/projects/content-creator/analytics/reply-tracking/latest.json` for the Newsroom dashboard. KOL→niche config lives in `src/config/kol-niches.ts` (niches: `security|tokenomics|l1l2|other`; unknown handles → `other`).

## Release workflow

After each implementation, run in order:

1. `npm test` — all 39 tests must pass
2. `tsc --noEmit` — must pass clean before bumping version
3. Bump `"version"` in `package.json`
4. Update `## Current version:` in `CLAUDE.md`
5. Add entry `## [X.Y.Z]` at top of `CHANGELOG.md`
6. *(only when user requests "update docs/readme/overview", or changes affect documented flows)*
   - Update `PROJECT_OVERVIEW.md` — module notes + Known Issues table + footer version/date
   - Update `README.md` — bullets related to changed features
   - Update memory file `/Users/lavopavden/.claude/projects/-Users-lavopavden-Dev-projects-InkPilot/memory/project_overview.md` — version + version history table row

## Test conventions

Tests use in-memory SQLite — call `resetDb()` before each `createTestDb()`. Mock Anthropic SDK with `vi.spyOn`. Never make real HTTP or API calls in tests. All 5 test files in `tests/`, all 71 tests must pass before any PR.

## Don't

- Re-score already-scored articles
- Break the `db?: Database.Database` optional param pattern on DB functions
- Add Anthropic API calls that don't use `AI_MODELS.*` for the model ID
- Edit DB source config directly — always go through `rss-sources.ts`
- Add a `--refresh` equivalent to scoring (scoring is intentionally one-way)

# InkPilot — PROJECT OVERVIEW
*Tổng quan dự án / Project overview (English–Vietnamese)*

---

## 1. Project Overview | Tổng quan dự án

**EN — What it does**
A **local-first CLI tool** for crypto content research. It **scrapes RSS feeds** from configurable sources (crypto, protocol, DeFi, AI, Vietnamese), **deduplicates by URL**, **extracts OG images**, and stores everything in a **SQLite database**. New articles are automatically **scored by Claude Haiku** (0–10, decimal) for relevance, with results surfaced in a **tiered inbox** (HOT 7.5+ / OTHER 6–7.4 / auto-dismissed < 6). Each article includes a **suggested angle** for writing personal takes. For any HOT article, the user can generate a **research brief via Claude Sonnet** — including WHY IT MATTERS, related stories, and bilingual suggested angles (Vietnamese primary + English) personalized to the user's voice and tone. The user **composes posts manually** and publishes to **X (Twitter)** — this is NOT an auto-posting bot.

**VI — Ứng dụng làm gì**
Công cụ **CLI local-first** phục vụ nghiên cứu nội dung crypto. Scrape **RSS** từ nhiều nguồn, **dedup theo URL**, **lấy ảnh OG**, lưu vào **SQLite**. Bài mới tự động được **Claude Haiku chấm điểm** (0–10, decimal) theo relevance, hiển thị trong **tiered inbox** (HOT 7.5+ / OTHER 6–7.4 / auto-dismissed < 6). Mỗi bài có **suggested angle** để viết take. Với bài HOT, user có thể generate **research brief qua Claude Sonnet** — bao gồm WHY IT MATTERS, bài liên quan, và suggested angles song ngữ (VN primary + EN) cá nhân hóa theo voice/tone của user. Người dùng **tự viết bài** rồi đăng lên **X (Twitter)** — đây KHÔNG phải bot tự động.

**EN — Target users**
Content creators and crypto researchers who want a **structured research pipeline** — automated feed collection, AI-powered relevance scoring, Sonnet-powered research briefs, manual curation, and human-written posts published to X.

**VI — Đối tượng**
Content creator và researcher crypto muốn **pipeline nghiên cứu có cấu trúc** — tự động thu thập feed, AI scoring, research brief bằng Sonnet, tự tay lọc bài, tự viết rồi đăng lên X.

---

## 2. Tech Stack | Công nghệ

| Layer / Lớp | EN | VI |
|-------------|----|----|
| **Runtime** | Node.js 20+, TypeScript 5.7, `tsx` | Node.js 20+, TypeScript 5.7, `tsx` |
| **Database** | SQLite via `better-sqlite3` (sync API, WAL mode) — 7 tables | SQLite qua `better-sqlite3` (sync API, WAL mode) — 7 bảng |
| **AI — Filter** | Anthropic SDK — Claude Haiku (`claude-haiku-4-5-20251001`): batch relevance scoring (10 articles/call), decimal scores | Anthropic SDK — Claude Haiku: chấm điểm hàng loạt (10 bài/call), điểm decimal |
| **AI — Brief** | Anthropic SDK — Claude Sonnet (`AI_MODELS.sonnet` → `claude-sonnet-4-6`): per-article brief, bilingual angles (strict hook-first prompts), cached | Anthropic SDK — Claude Sonnet: brief từng bài, song ngữ, có cache |
| **Model IDs** | `AI_MODELS` in `src/config/index.ts` — `haiku` + `sonnet` strings shared by Haiku filter and Sonnet briefer | `AI_MODELS` trong `src/config/index.ts` — cấu hình model tập trung |
| **Vault export** | After each `npm run brief`, fills `~/Dev/vault/templates/angle-template.md` (`__KEY__` placeholders) → writes `~/Dev/vault/projects/content-creator/angles/*.md` for Obsidian | Sau mỗi brief: điền template → ghi `.md` vào vault (Obsidian) |
| **RSS** | `rss-parser` — parallel multi-feed scraping with 10s timeout | `rss-parser` — scrape nhiều nguồn song song, timeout 10 giây |
| **OG Image** | Native `fetch` — extract `og:image` from HTML, 5s timeout | Native `fetch` — lấy `og:image` từ HTML, timeout 5 giây |
| **Config** | `dotenv` + `.env`; RSS sources as TS module (`rss-sources.ts`) | `dotenv` + `.env`; nguồn RSS trong TS module |
| **User Context** | Reads `about-me.md` + `tone-guidelines.md` from filesystem at runtime | Đọc `about-me.md` + `tone-guidelines.md` từ filesystem khi chạy |
| **Publishing (planned)** | X (Twitter) API | X (Twitter) API |
| **Test** | Vitest — in-memory SQLite, mocked Anthropic SDK (Haiku + Sonnet) | Vitest — SQLite in-memory, mock Anthropic SDK (Haiku + Sonnet) |
| **Dev** | ESLint 9, `@typescript-eslint`, strict TypeScript | ESLint 9, `@typescript-eslint`, strict TypeScript |

---

## 3. Core Features | Tính năng chính

| EN | VI |
|----|----|
| **Multi-source RSS scraping** — parallel fetch via `Promise.allSettled`, 16 configurable sources (9 enabled) across 4 tiers, 10s timeout per feed; one feed failure doesn't crash the rest. | **Scrape RSS nhiều nguồn** — fetch song song qua `Promise.allSettled`, 16 nguồn (9 enabled) chia 4 tier, timeout 10 giây; lỗi 1 feed không ảnh hưởng các feed khác. |
| **AI relevance filter (Haiku)** — batch up to 10 articles per call, decimal scores 0–10 (e.g. 7.2, 8.5), 12 fixed categories (L2, DeFi, AI x Crypto, Developer Tooling, SocialFi, Bitcoin, Regulation, Macro, Research/Protocol, Price/Trading, Exchange/Corporate, Other), reasoning + suggested angle; drops below 6 → auto-dismissed. | **Lọc AI (Haiku)** — batch tới 10 bài/call, điểm decimal 0–10, 12 category cố định, reasoning + suggested angle; dưới 6 → auto-dismissed. |
| **Tiered inbox** — HOT (7.5+) shown by default with suggested angles, OTHER (6–7.4) via `--other`, dismissed hidden; `--all` to show everything. Recency filter: 30 days default, `--days=N` to override. | **Tiered inbox** — HOT (7.5+) hiện mặc định với suggested angle, OTHER (6–7.4) qua `--other`, dismissed ẩn; `--all` hiện tất cả. Recency filter: 30 ngày mặc định, `--days=N` để override. |
| **Research brief (Sonnet)** — `npm run brief <id>` generates: WHY IT MATTERS (2–3 sentences), related stories (last 7 days, score ≥ 6), suggested angles (VN primary + EN). Personalized via user context files. Cached in DB — second run skips API. | **Research brief (Sonnet)** — `npm run brief <id>` tạo: WHY IT MATTERS (2–3 câu), bài liên quan (7 ngày, score ≥ 6), suggested angles (VN chính + EN). Cá nhân hóa qua user context files. Cache trong DB — lần 2 không gọi API. |
| **URL dedup** — `INSERT OR IGNORE` on UNIQUE url constraint; second fetch of same articles silently skipped. | **Dedup theo URL** — `INSERT OR IGNORE` trên constraint UNIQUE; fetch lại không tạo bản trùng. |
| **OG image extraction** — fetches article HTML, regex-extracts `og:image` meta tag; max 5 concurrent requests; never throws. | **Lấy ảnh OG** — fetch HTML bài viết, regex lấy `og:image`; tối đa 5 request song song; không throw. |
| **Article state machine** — `new` → `read` → `starred` → `drafted` → `posted` → `dismissed`; each article gets a state row on insert. | **State machine bài viết** — `new` → `read` → `starred` → `drafted` → `posted` → `dismissed`; mỗi bài có state row khi insert. |
| **Source upsert** — `seedSources()` uses `ON CONFLICT(slug) DO UPDATE`; config changes to URL, enabled, tier auto-sync to DB. | **Upsert nguồn** — `seedSources()` dùng `ON CONFLICT(slug) DO UPDATE`; thay đổi URL, enabled, tier tự sync vào DB. |
| **Idempotent scoring** — articles already in `filter_results` are never re-scored; previously unscored articles are picked up on next fetch. | **Scoring idempotent** — bài đã có `filter_results` không score lại; bài chưa score được lấy ở lần fetch sau. |
| **Brief cache** — Sonnet brief serialized as JSON in `filter_results.ai_context`; second `npm run brief` returns cached result without API call; `--refresh` skips cache and overwrites. | **Cache brief** — JSON trong `filter_results.ai_context`; lần 2 không gọi Sonnet; `--refresh` bỏ qua cache. |
| **Angle markdown export** — `angle-exporter.ts` reads template with `__KEY__` placeholders (Obsidian-safe; no `{{}}` in YAML), writes `YYYY-MM-DD-<articleId>-<slug>.md`; missing template logs warning only. | **Export angle .md** — template `__KEY__`, ghi file theo ngày + id + slug; thiếu template chỉ warn. |
| **Cost tracking** — Haiku + Sonnet token usage (input/output) and USD estimate per operation. | **Theo dõi chi phí** — đếm token Haiku + Sonnet (in/out) và ước tính USD mỗi lần chạy. |
| **Source status** — `npm run sources:status` prints per-source table: enabled/disabled, article count, last article date, last fetch timestamp; no API key required. | **Trạng thái nguồn** — `npm run sources:status` in bảng per-source: enabled/disabled, số bài, ngày bài gần nhất, lần fetch cuối; không cần API key. |
| **Verbose fetch** — `npm run fetch -- --verbose` logs per-feed item count + new/dup breakdown after each source; default output unchanged. | **Fetch verbose** — `npm run fetch -- --verbose` log per-feed số item + new/dup sau mỗi nguồn; output mặc định không đổi. |
| **Scoring diagnostic** — `npm run stats:scoring [--days=N]` prints total scored / HOT / OTHER / dismissed with percentages, avg score, 8-bucket histogram (split at 7.5) with bar chart, and Haiku-assigned category breakdown. Read-only, no API key needed. | **Diagnostic scoring** — `npm run stats:scoring [--days=N]` in tổng số, tỉ lệ HOT/OTHER/dismissed, histogram 8 bucket (chia tại 7.5), breakdown theo Haiku category. Chỉ đọc, không cần API key. |
| **Per-source diagnostic** — `npm run stats:sources [--days=N]` prints per-source table: total scored, avg score, HOT / OTHER / dismissed counts, HOT% rate. Ordered by HOT count then avg score. | **Diagnostic per nguồn** — `npm run stats:sources [--days=N]` in bảng per-source: số bài scored, avg score, HOT/OTHER/dismissed, HOT%. Sắp xếp theo HOT rồi avg score. |
| **Near-HOT inspector** — `npm run inspect:near-hot [--limit=N] [--days=N]` lists articles scoring 7.0–7.4 with full untruncated Haiku reasoning and suggested angle; use to diagnose whether the 7.5 HOT threshold needs adjustment. | **Inspect near-HOT** — `npm run inspect:near-hot` liệt kê bài score 7–7.4 với full Haiku reasoning và suggested angle; dùng để kiểm tra threshold 7.5 có phù hợp không. |

**EN — Not yet built (planned slices):** X API adapter (Slice 5), TUI / Ink (Slice 6+).
**VI — Chưa xây (slice sắp tới):** X API adapter (Slice 5), TUI / Ink (Slice 6+).

---

## 4. Architecture | Kiến trúc

### 4.1 Mermaid — High-level architecture | Kiến trúc tổng thể

```mermaid
flowchart TB
  subgraph External["External / Bên ngoài"]
    RSS["RSS Feeds\n(9 enabled sources)"]
    WEB["Source websites\n(OG image)"]
    AN_H["Anthropic API\nClaude Haiku"]
    AN_S["Anthropic API\nClaude Sonnet"]
    UC["User context files\nabout-me.md\ntone-guidelines.md"]
    VAULT["Obsidian vault\nangle-template.md\nangles/*.md"]
    XA["X / Twitter API\n(planned)"]
  end

  subgraph CLI["CLI Scripts"]
    FETCH["scripts/fetch.ts\nnpm run fetch [--verbose]"]
    LIST["scripts/list.ts\nnpm run list"]
    BRIEF["scripts/brief.ts\nnpm run brief <id>"]
    STATUS["scripts/sources-status.ts\nnpm run sources:status"]
    STATS_S["scripts/stats-scoring.ts\nnpm run stats:scoring"]
    STATS_SRC["scripts/stats-sources.ts\nnpm run stats:sources"]
    INSPECT["scripts/inspect-near-hot.ts\nnpm run inspect:near-hot"]
  end

  subgraph FeedFetcher["feed-fetcher/"]
    RP["rss-parser.ts\nfetchFeed"]
    OG["og-extractor.ts\nextractOgImageUrl"]
    ORCH["index.ts\nrunFetch orchestrator"]
  end

  subgraph Filter["content-filter/"]
    HF["haiku-filter.ts\nscoreArticles (batch 10)"]
    FO["index.ts\nfilterNewArticles"]
  end

  subgraph Briefer["research-briefer/"]
    SB["sonnet-briefer.ts\ngenerateBriefWithSonnet"]
    AE["angle-exporter.ts\nexportAngleFile"]
    BO["index.ts\ngenerateBrief orchestrator"]
    FMT["formatter.ts\nprintBrief"]
  end

  subgraph DB["database/"]
    SRC["sources.ts\nseedSources · getEnabled"]
    ART["articles.ts\ninsertArticle · getWithFilter"]
    AST["article-states.ts\ncreate · update"]
    FR["filter-results.ts\ninsert · isScored\ncacheBrief · getCachedBrief"]
    POSTS["posts.ts\ninsertPost · getByPlatform"]
    SCHEMA["schema.ts\n7 tables"]
  end

  subgraph Config["config/"]
    CFG["index.ts\n.env loader"]
    RSSCFG["rss-sources.ts\n11 sources × 4 tiers"]
  end

  FETCH --> RSSCFG
  FETCH --> ORCH
  ORCH --> RP --> RSS
  ORCH --> OG --> WEB
  ORCH --> FO --> HF --> AN_H
  ORCH --> ART
  ORCH --> AST
  ORCH --> SRC
  FO --> FR
  FO --> AST
  LIST --> ART
  LIST --> SRC
  LIST --> FR
  BRIEF --> BO
  BO --> SB --> AN_S
  BO --> AE --> VAULT
  BO --> FR
  BO --> ART
  SB --> UC
  BO --> FMT
  CFG --> DB
  STATUS --> SRC
  STATS_S --> FR
  STATS_SRC --> FR
  STATS_SRC --> SRC
  INSPECT --> FR
  INSPECT --> SRC
  RSSCFG --> SRC
```

### 4.2 Mermaid — CLI entry points | Các điểm vào CLI

```mermaid
flowchart TB
  CLI["npm scripts"]
  CLI --> FETCH["npm run fetch [--verbose]\nscrape → dedup → OG → Haiku score"]
  CLI --> LIST["npm run list\n--hot · --other · --all\n--today · --days=N"]
  CLI --> BRIEF["npm run brief <id> [--refresh]\nSonnet → cache → angle .md"]
  CLI --> STATUS["npm run sources:status\nsource health + article counts"]
  CLI --> STATS_S["npm run stats:scoring [--days=N]\nscoring histogram + category breakdown"]
  CLI --> STATS_SRC["npm run stats:sources [--days=N]\nper-source HOT rate table"]
  CLI --> INSPECT["npm run inspect:near-hot [--limit=N]\nfull reasoning for score 7–7.9 articles"]
  CLI --> TEST["npm test\nvitest run (39 tests)"]

  FETCH --> DB[("SQLite\n~/.inkpilot/inkpilot.db")]
  STATS_S --> DB
  STATS_SRC --> DB
  INSPECT --> DB
  FETCH --> AN_H["Anthropic API\nClaude Haiku"]
  LIST --> DB
  BRIEF --> DB
  BRIEF --> AN_S["Anthropic API\nClaude Sonnet"]
  BRIEF --> UC["User context files"]
  STATUS --> DB
```

### 4.3 Module notes

- **Sync DB, async HTTP + AI:** `better-sqlite3` is synchronous (no `await` on DB calls); all `async/await` is limited to HTTP fetching (RSS, OG extraction) and Anthropic API calls (Haiku + Sonnet).

- **Graceful degradation:** `Promise.allSettled` for feed fetching — each source is independent. OG extractor never throws. Haiku API failure → articles keep state `new`, scored on next fetch. Sonnet API failure → partial brief returned with empty angles.

- **Batch scoring:** Haiku receives up to 10 articles per call with title + snippet. Response is JSON array with decimal score, category, reasoning, suggestedAngle. Malformed response → fallback score 5.

- **Research brief:** Sonnet receives single article context + related articles + user context (about-me + tone-guidelines). Response is JSON with whyItMatters + suggestedAngles (VN + EN; strict angle rules — hook first, no news recap). Result cached in `filter_results.ai_context` — second call returns from cache unless `--refresh`. After every brief, `exportAngleFile` fills the vault template (`__KEY__` placeholders) and writes a markdown file under `~/Dev/vault/projects/content-creator/angles/`.

- **Concurrency control:** RSS feeds fetched in full parallel; OG image extraction limited to 5 concurrent; Haiku batches run sequentially (to avoid rate limits); Sonnet briefs are single-article calls.

- **Schema migration:** `migrations.ts` detects old tables and drops/recreates — safe because sources are re-seeded and scoring is idempotent.

---

## 5. Key Files / Modules | File và module quan trọng

| Path | EN (role) | VI (vai trò) |
|------|-----------|--------------|
| `src/scripts/fetch.ts` | CLI entry: seed sources → scrape RSS → insert → OG → Haiku score → cost summary; `--verbose` flag logs per-source item/new/dup counts | CLI: seed → scrape → insert → OG → score → chi phí; `--verbose` log per-source |
| `src/scripts/list.ts` | CLI entry: tiered inbox (HOT/OTHER), `--hot`, `--other`, `--all`, `--today`, `--days=N`, `--source`, `--state`; footer shows `"X of Y"` total count when limit is hit; condition building shared via `buildArticleConditions` + `countScoredArticles` | CLI list: tiered inbox, filter đa dạng, recency filter, total count trong footer |
| `src/scripts/brief.ts` | CLI: `npm run brief <id> [--refresh]` → load → cache? → Sonnet? → cache DB → export angle `.md` → print | CLI brief + refresh + export vault |
| `src/scripts/sources-status.ts` | CLI: `npm run sources:status` — init DB → seed → `getSourcesStatus()` → print aligned table (name, enabled, article count, last article date, last fetch) | CLI trạng thái nguồn — bảng per-source, không cần API key |
| `src/scripts/stats-scoring.ts` | CLI: `npm run stats:scoring [--days=N]` — 8-bucket histogram (split at `SCORE_THRESHOLDS.HOT = 7.5`; buckets: `7–7.5` near-HOT, `7.5–8` ← HOT) + HOT/OTHER/dismissed totals + avg score; second query for Haiku-assigned category breakdown; read-only, no API key | CLI diagnostic scoring: histogram 8 bucket, tỉ lệ, category breakdown |
| `src/scripts/stats-sources.ts` | CLI: `npm run stats:sources [--days=N]` — JOIN `filter_results → articles → sources`, GROUP BY `source_id`, ordered by HOT count then avg score; `✓` marks sources with ≥1 HOT article; totals row at footer | CLI diagnostic per-source: HOT rate, avg score, counts |
| `src/scripts/inspect-near-hot.ts` | CLI: `npm run inspect:near-hot [--limit=N] [--days=N]` — queries `score >= 7.0 AND score < 7.5` (below HOT threshold), JOIN sources; prints full `reasoning` + `suggested_angle` untruncated per article | CLI inspector: near-HOT articles + full Haiku reasoning |
| `src/config/index.ts` | Loads `.env` → exports typed `Config`; exports `AI_MODELS` (Haiku + Sonnet API model IDs) and `SCORE_THRESHOLDS` (`HOT = 7.5`, `OTHER_MIN = 6.0`) | Load `.env` + `AI_MODELS` + `SCORE_THRESHOLDS` |
| `src/config/types.ts` | `Config` interface | Interface `Config` |
| `src/config/rss-sources.ts` | Source of truth for all RSS feeds: 16 sources × 4 tiers, typed `RssSourceConfig[]`; optional `articleDomain?: string` for sources where feed host ≠ article URL host (e.g. Vitalik: feed at `vitalik.eth.limo`, articles at `vitalik.ca`) | Danh sách RSS: 16 nguồn × 4 tier; `articleDomain` override khi feed host ≠ article host |
| `src/content-filter/index.ts` | `filterNewArticles` orchestrator: load articles → batch → score → insert results → update states | Orchestrator scoring: load → batch → score → insert → update state |
| `src/content-filter/haiku-filter.ts` | `scoreArticles`: Anthropic SDK call, JSON parse, fallback on error, cost calculation | Gọi Anthropic SDK, parse JSON, fallback khi lỗi, tính chi phí |
| `src/content-filter/types.ts` | `ArticleToScore`, `FilterResult`, `BatchFilterResult` | Types cho content filter |
| `src/research-briefer/index.ts` | `generateBrief` orchestrator: load → cache? → related → user context → Sonnet → cache DB → `exportAngleFile` | Orchestrator brief + export angle |
| `src/research-briefer/sonnet-briefer.ts` | `generateBriefWithSonnet`: Sonnet API call, `loadUserContext`, JSON parse, cost calculation | Gọi Sonnet API, load user context, parse JSON, tính chi phí |
| `src/research-briefer/angle-exporter.ts` | `exportAngleFile`: read `~/Dev/vault/templates/angle-template.md`, replace `__KEY__`, write `angles/YYYY-MM-DD-<id>-<slug>.md` | Điền template → ghi file Obsidian |
| `src/research-briefer/formatter.ts` | `printBrief`: terminal output + optional `💾 Saved:` path | Hiển thị brief + đường dẫn file angle |
| `src/research-briefer/types.ts` | `Brief`, `RelatedArticle`, `SuggestedAngles` | Types cho research briefer |
| `src/database/schema.ts` | `CREATE TABLE` for all 7 tables + indexes | Schema 7 bảng + index |
| `src/database/index.ts` | Singleton DB connection (`initDb`/`getDb`/`closeDb`/`resetDb`); WAL mode, foreign keys | Kết nối DB singleton; WAL mode |
| `src/database/migrations.ts` | Runs schema; auto-migrates old `sources` and `filter_results` tables | Chạy schema; tự migrate bảng cũ |
| `src/database/sources.ts` | `seedSources` (upsert), `getEnabledSources`, `getSourceBySlug`, `updateLastFetchedAt`, `getSourcesStatus`, `repairArticleSourceIds` (re-maps `articles.source_id` by URL domain after migrations that reset auto-increment IDs) | CRUD bảng sources (upsert) + status query + repair |
| `src/database/articles.ts` | `insertArticle` (dedup), `getArticlesWithFilter` (flexible JOIN query), `updateOgImage` | CRUD bảng articles |
| `src/database/article-states.ts` | `createArticleState`, `updateArticleState`, `getArticleState` | CRUD bảng article_states |
| `src/database/filter-results.ts` | `insertFilterResult`, `isArticleScored`, `getUnscoredArticleIds`, `cacheArticleBrief`, `getCachedBrief` | CRUD bảng filter_results + cache brief |
| `src/database/posts.ts` | `insertPost`, `getPostById`, `getPostsByPlatform`, `countTodayPosts` | CRUD bảng posts |
| `src/database/types.ts` | Shared types: `ArticleState`, `Source`, `Article`, `ArticleStateRow` | Types dùng chung |
| `src/feed-fetcher/index.ts` | `runFetch` orchestrator: parallel feeds → dedup → OG → scoring → `FetchResult` | Orchestrator: fetch → dedup → OG → scoring |
| `src/feed-fetcher/rss-parser.ts` | `fetchFeed(url)` → `FeedItem[]`; 10s timeout, HTML tag stripping | Parse RSS feed, timeout 10 giây |
| `src/feed-fetcher/og-extractor.ts` | `extractOgImageUrl(url)` → `string \| null`; 5s timeout, never throws | Lấy og:image, timeout 5 giây, không throw |
| `src/utils/logger.ts` | `createLogger(context)` — leveled (`debug`/`info`/`warn`/`error`), colored, timestamped | Logger có màu, theo cấp độ |
| `.env.example` | Env template: `ANTHROPIC_API_KEY`, `DB_PATH`, `LOG_LEVEL` | Template biến môi trường |
| `tests/database.test.ts` | 8 tests: schema init, posts CRUD (platform `x`) | 8 test: schema, posts CRUD |
| `tests/feed-fetcher.test.ts` | 14 tests: sources seeding, article dedup, article states, mocked runFetch | 14 test: seed nguồn, dedup, states, mock fetch |
| `tests/content-filter.test.ts` | 10 tests: filter DB CRUD, scoring + state transitions, mocked Anthropic, fallback, cost calc | 10 test: filter DB, scoring, mock Anthropic, fallback |
| `tests/research-briefer.test.ts` | 7 tests: brief cache, related articles query, mocked Sonnet, API failure fallback, user context fallback, cost calc | 7 test: cache, related, mock Sonnet, fallback, cost |
| `templates/angle-template.md` | Repo copy of vault template (`__KEY__` placeholders); copy to `~/Dev/vault/templates/angle-template.md` | Template góc — copy vào vault |

---

## 6. Data Flow | Luồng dữ liệu

### 6.1 Fetch pipeline: RSS → Haiku → SQLite

```mermaid
sequenceDiagram
  participant CLI as npm run fetch
  participant SEED as seedSources
  participant FF as feed-fetcher
  participant RSS as RSS Feeds (6)
  participant DB as SQLite
  participant OG as og-extractor
  participant WEB as Source websites
  participant HK as Claude Haiku

  CLI->>SEED: seedSources(RSS_SOURCES) — upsert
  SEED->>DB: INSERT ... ON CONFLICT(slug) DO UPDATE
  CLI->>FF: runFetch()
  FF->>DB: getEnabledSources()
  DB-->>FF: Source[]
  FF->>RSS: fetchFeed (parallel, Promise.allSettled)
  RSS-->>FF: FeedItem[] per source
  loop Each feed item
    FF->>DB: insertArticle (INSERT OR IGNORE)
    DB-->>FF: { inserted, id }
    alt New article
      FF->>DB: createArticleState(id, 'new')
    end
  end
  FF->>OG: extractOgImageUrl (5 concurrent)
  OG->>WEB: fetch HTML, regex og:image
  WEB-->>OG: image URL | null
  OG-->>FF: url | null
  FF->>DB: updateOgImage(id, url)
  FF->>DB: getUnscoredNewArticleIds()
  DB-->>FF: unscored article IDs
  loop Batch of 10
    FF->>HK: scoreArticles(batch)
    HK-->>FF: FilterResult[] (score, category, reasoning, suggestedAngle)
    FF->>DB: insertFilterResult per article
    alt score < 6
      FF->>DB: updateArticleState → 'dismissed'
    end
  end
  FF-->>CLI: FetchResult { new, duplicates, errors, scoring }
```

### 6.2 List: SQLite → Tiered Inbox

```mermaid
flowchart LR
  CLI["npm run list\n--hot · --other · --all\n--today · --days=N\n--source · --state"]
  CLI --> DB[("SQLite\narticles JOIN sources\nJOIN article_states\nJOIN filter_results")]
  DB --> HOT["HOT 🔥 (score 7.5+)\nwith suggested angles"]
  DB --> OTHER["OTHER (score 6–7.4)"]
  DB --> ALL["ALL (--all flag)"]
```

### 6.3 Brief: Article → Sonnet → Cache

```mermaid
sequenceDiagram
  participant CLI as npm run brief <id>
  participant BO as research-briefer
  participant DB as SQLite
  participant UC as User context files
  participant SN as Claude Sonnet

  CLI->>BO: generateBrief(articleId, { forceRefresh? })
  BO->>DB: getArticleById(id)
  DB-->>BO: Article
  BO->>DB: getFilterResult(id)
  DB-->>BO: FilterResultRow (score, category, reasoning)
  BO->>DB: getCachedBrief(id)
  alt Cache hit & no refresh
    DB-->>BO: cached JSON
  else Cache miss or refresh
    BO->>DB: queryRelatedArticles (7d, score≥6, same category/keyword)
    DB-->>BO: RelatedArticle[] (max 5)
    BO->>UC: loadUserContext()
    UC-->>BO: about-me + tone-guidelines (or empty)
    BO->>SN: generateBriefWithSonnet(article, related, userContext)
    SN-->>BO: { whyItMatters, suggestedAngles }
    BO->>DB: cacheArticleBrief(id, briefJSON) if success
  end
  BO->>BO: exportAngleFile (vault template → angles/*.md)
  BO-->>CLI: Brief + savedAnglePath?
  CLI->>CLI: printBrief(brief)
```

---

## 7. Database Schema | Schema cơ sở dữ liệu

```
sources          — 16 RSS feeds, upserted from config (slug UNIQUE, name, url, category, tier, language, enabled)
articles         — fetched articles (url UNIQUE, title, content, author, published_at, og_image_url)
article_states   — state machine per article (new → read → starred → drafted → posted → dismissed)
filter_results   — Haiku scoring + Sonnet brief cache (article_id UNIQUE, score, category, reasoning, suggested_angle, ai_context for cached brief, tokens, model)
drafts           — AI-generated drafts (planned — Slice 5)
posts            — published posts to X (planned — Slice 5)
post_metrics     — engagement metrics (planned — Slice 5+)
```

---

## 8. RSS Sources | Nguồn RSS

| Tier | Nguồn | Category | Language | Interval | Status |
|------|-------|----------|----------|----------|--------|
| 1 | Decrypt, Bankless, CoinDesk, Blockworks | crypto / defi | en | 1h | enabled |
| 1 | ETH Research Forum, Bitcoin Optech | research-technical | en | 1h | enabled |
| 1 | The Block | crypto | en | 1h | **disabled** — Cloudflare blocks all non-browser requests (HTTP 403) |
| 2 | Ethereum Foundation Blog, Arbitrum Foundation | protocol / protocol-l2 | en | 1h | enabled |
| 2 | Base Blog | protocol | en | 1h | **disabled** — `base.mirror.xyz` dead; `blog.base.org` Cloudflare JS challenge |
| 2 | Optimism Blog | protocol-l2 | en | 1h | **disabled** — `optimism.mirror.xyz` + all Paragraph alternatives stale since Jun 2025 |
| 2 | Vitalik's Blog | protocol | en | 1h | **disabled** — retained for FK integrity (171 articles in DB) |
| 3 | CoinCu News | vietnamese | vi | 2h | enabled |
| 3 | Coin68, Tạp Chí Bitcoin | vietnamese | vi | 2h | **disabled** — retained for FK integrity |
| 4 | MarkTechPost | ai | en | 2h | **disabled** — retained for FK integrity (10 articles in DB) |

---

## 9. AI Systems | Hệ thống AI

### 9.1 Haiku Scoring — Relevance filter

| EN | VI |
|----|----|
| **9.0–10.0**: Significant protocol update, major ecosystem development, original research | **9.0–10.0**: Update protocol lớn, phát triển hệ sinh thái quan trọng, nghiên cứu gốc |
| **7.0–8.9**: Interesting development, clear angle, relevant to focus areas | **7.0–8.9**: Phát triển thú vị, có angle rõ, liên quan focus areas |
| **5.0–6.9**: Tangentially relevant, low angle potential | **5.0–6.9**: Liên quan nhẹ, ít tiềm năng viết take |
| **0.0–4.9**: Spam, listicle, price prediction, auto-dismissed | **0.0–4.9**: Spam, listicle, dự đoán giá, tự ẩn |

**Focus areas (score higher):** L2 & infrastructure, DeFi, SocialFi & decentralized social, AI × Crypto, Developer tooling, Vietnamese crypto community.

**Penalty areas (score lower):** Price analysis, celebrity endorsements, meme coin launches, exchange listings, generic regulation, listicles, airdrop guides.

| Metric | Value |
|--------|-------|
| Model | `AI_MODELS.haiku` (`claude-haiku-4-5-20251001`) |
| Batch size | 10 articles/call |
| Pricing | $0.80/1M input, $4.00/1M output |
| Real-world cost | ~$0.50 per 1000 articles scored |

### 9.2 Sonnet Brief — Research assistant

| Component / Thành phần | EN | VI |
|------------------------|----|----|
| **WHY IT MATTERS** | 2–3 sentences, specific, data-backed, no hype | 2–3 câu, cụ thể, có số liệu, không hype |
| **RELATED STORIES** | Up to 5 articles from last 7 days, score ≥ 6, same category or shared keywords | Tối đa 5 bài trong 7 ngày, score ≥ 6, cùng category/keyword |
| **SUGGESTED ANGLES (VN)** | 2–3 Vietnamese angles — conversational, crypto slang OK, data-backed | 2–3 góc VN — ngôn ngữ thoải mái, slang crypto OK, có data |
| **SUGGESTED ANGLES (EN)** | 1–2 English angles — casual professional, crypto native | 1–2 góc EN — chuyên nghiệp nhưng thoải mái, crypto native |
| **User context** | Reads `about-me.md` + `tone-guidelines.md` from `~/Dev/projects/Content-Creator/` | Đọc `about-me.md` + `tone-guidelines.md` từ `~/Dev/projects/Content-Creator/` |
| **Cache** | Brief JSON stored in `filter_results.ai_context`; second call returns cached; `--refresh` regenerates | Cache trong DB; `--refresh` gọi lại Sonnet |
| **Vault .md** | Template at `~/Dev/vault/templates/angle-template.md` with `__KEY__` placeholders; output `~/Dev/vault/projects/content-creator/angles/*.md` | File Obsidian sau mỗi brief |

| Metric | Value |
|--------|-------|
| Model | `AI_MODELS.sonnet` (`claude-sonnet-4-6`) |
| Max tokens | 1000 |
| Pricing | $3.00/1M input, $15.00/1M output |
| Real-world cost | ~$0.01 per brief |

---

## 10. Known Issues / Constraints | Hạn chế đã biết

| EN | VI |
|----|----|
| **7 feeds disabled** — The Block (Cloudflare 403, all UA variants blocked), Base Blog (`base.mirror.xyz` dead, `blog.base.org` Cloudflare JS challenge), Optimism Blog (all Mirror + Paragraph endpoints stale since Jun 2025); Vitalik's Blog, Coin68, Tạp Chí Bitcoin, MarkTechPost retained as disabled for FK integrity (articles in DB). | **7 feed disabled** — The Block (Cloudflare 403), Base Blog (URL chết + Cloudflare), Optimism Blog (stale Jun 2025); Vitalik, Coin68, TCB, MarkTechPost giữ lại để bảo toàn FK. |
| **No scheduler** — `npm run fetch` runs manually or via external cron. | **Không có scheduler** — `npm run fetch` chạy tay hoặc cron ngoài. |
| **No X API yet** — posts table exists but no publishing adapter (Slice 5). | **Chưa có X API** — bảng posts đã có nhưng chưa có adapter đăng bài (Slice 5). |
| **`recasts` column name** — `post_metrics` table still uses `recasts`; will rename to `reposts` in X adapter slice. | **Tên cột `recasts`** — bảng `post_metrics` vẫn dùng `recasts`; sẽ đổi thành `reposts` khi làm X adapter. |
| **Sequential Haiku batches** — batches run one at a time; 1000 articles takes ~15 minutes. | **Batch Haiku tuần tự** — batch chạy lần lượt; 1000 bài mất ~15 phút. |
| **903 articles with integer scores** — pre-decimal-fix articles still have whole-number scores; not re-scored. | **903 bài có score số nguyên** — các bài score trước khi fix decimal vẫn giữ score cũ; không re-score. |

---

## Related docs | Tài liệu liên quan

- **Run & intro:** [README.md](./README.md)

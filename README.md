# InkPilot

Công cụ CLI **local-first** phục vụ nghiên cứu nội dung crypto — scrape **RSS** từ nhiều nguồn, **AI scoring** bằng Claude Haiku (0–10), **research brief** bằng Claude Sonnet, lưu vào **SQLite**, hiển thị tiered inbox (HOT / OTHER). Người dùng tự viết bài rồi đăng lên **X (Twitter)**. Đây KHÔNG phải bot tự động — mọi post đều do người viết và duyệt.

---

## Overview

**TypeScript + Node.js**, scrape RSS song song từ 11 nguồn (6 enabled), dedup theo URL, score bằng **Claude Haiku** (batch 10 bài/call), generate **research brief** bằng **Claude Sonnet** (per article), lưu vào SQLite (`better-sqlite3`). Mỗi bài viết được theo dõi qua state machine (`new` → `read` → `starred` → `drafted` → `posted` → `dismissed`). Bài score < 6 tự động `dismissed`.

Cấu hình credentials qua `.env`; nguồn RSS chỉnh trong `src/config/rss-sources.ts`.

Chi tiết kiến trúc, luồng dữ liệu và module: xem **[PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)**.

---

## Features

- **RSS scraper** — scrape 6 nguồn song song (`Promise.allSettled`), dedup theo URL (`INSERT OR IGNORE`), timeout 10 giây/feed.
- **AI scoring (Haiku)** — batch scoring 10 bài/call, điểm 0–10 (decimal, e.g. 7.2, 8.5) + category + reasoning + suggested angle; cost tracking (token + USD).
- **Tiered inbox** — HOT (score 8+) hiện mặc định với suggested angle, OTHER (6–7.9), Dismissed (< 6) tự ẩn. Recency filter 30 ngày mặc định, `--days=N` để override.
- **Research brief (Sonnet)** — `npm run brief <id>` generate brief cho bất kỳ article: WHY IT MATTERS + related stories + suggested angles (VN primary + EN). Hook-first angle prompts (không tóm tắt lại tin). Cache trong DB — lần 2 không gọi API; `npm run brief -- <id> --refresh` để gọi lại Sonnet và ghi đè cache.
- **Angle markdown (Obsidian)** — mỗi lần brief xong tự ghi file `.md` vào `~/Dev/vault/projects/content-creator/angles/` từ template `~/Dev/vault/templates/angle-template.md` (placeholder `__KEY__` — tương thích obsidian/YAML, không dùng `{{}}`). Terminal hiện `💾 Saved: ~/...`. Thiếu template → chỉ cảnh báo, brief vẫn hiện.
- **User context** — brief cá nhân hóa dựa trên `about-me.md` + `tone-guidelines.md` đọc từ `~/Dev/projects/Content-Creator/`; không có thì vẫn chạy.
- **OG image** — tự lấy `og:image` từ trang gốc, 5 request song song, timeout 5 giây; không bao giờ crash.
- **Article state machine** — `new` → `read` → `starred` → `drafted` → `posted` → `dismissed`.
- **Source upsert** — `seedSources()` dùng `ON CONFLICT DO UPDATE` — thay đổi URL hoặc enabled/disabled trong config tự sync vào DB.
- **Graceful degradation** — lỗi 1 feed hoặc Haiku/Sonnet API failure không crash toàn bộ.
- **Source status** — `npm run sources:status` in bảng per-source: enabled/disabled, số bài, ngày bài gần nhất, lần fetch cuối; không cần Anthropic API key.
- **Verbose fetch** — `npm run fetch -- --verbose` log per-feed: số item feed trả về, new vs duplicate sau mỗi nguồn.
- **39 tests** — Vitest, in-memory SQLite; bao gồm dedup, seeding, states, mocked Anthropic (cả Haiku và Sonnet), fallback scoring, brief cache.

---

## Tech stack

| Lớp | Công nghệ |
|-----|-----------|
| Runtime | Node.js 20+, TypeScript 5.7, `tsx` |
| Database | SQLite via `better-sqlite3` (sync API) |
| AI — Filter | Anthropic SDK — Claude Haiku (`claude-haiku-4-5-20251001`): batch relevance scoring |
| AI — Brief | Anthropic SDK — Claude Sonnet (`claude-sonnet-4-6`): research brief generation |
| RSS | `rss-parser` |
| Config | `dotenv` + `.env`; `AI_MODELS` (`haiku` / `sonnet`) trong `src/config/index.ts` — đổi model một chỗ cho toàn app |
| Test | Vitest |
| Publishing (planned) | X (Twitter) API |

---

## Cách chạy (How to run)

### Yêu cầu

- [Node.js](https://nodejs.org/) 20+ (khuyến nghị LTS)
- npm (đi kèm Node)
- [Anthropic API key](https://console.anthropic.com/) (cần cho scoring + brief)

### Cài đặt

```bash
cd InkPilot
npm install

cp .env.example .env
# Sửa .env: điền ANTHROPIC_API_KEY
```

---

## Sử dụng

### Fetch + Score bài viết

| Lệnh | Mô tả |
|------|--------|
| `npm run fetch` | Scrape RSS → dedup → insert → OG image → Haiku scoring |
| `npm run fetch -- --verbose` | Như trên + log per-feed: số item, new vs duplicate |

```bash
npm run fetch
# Output:
# Fetch complete:
#   Sources checked: 6
#   New articles:    14
#   Duplicates:      823
#   Scored:          14 (HOT: 3, OTHER: 7, Dismissed: 4)
#   Cost:            $0.0031 (Haiku: 3.2K in, 1.4K out tokens)

npm run fetch -- --verbose
# Thêm per-feed log:
#   Decrypt: 25 items → 3 new, 22 duplicates
#   Bankless: 18 items → 2 new, 16 duplicates
#   ...
```

### Xem bài viết (Tiered Inbox)

```bash
# Mặc định: hiện HOT trước, sau đó OTHER (last 30 days)
npm run list

# Chỉ HOT (score 8+) — có suggested angle
npm run list -- --hot

# Chỉ OTHER (score 6–7.9)
npm run list -- --other

# Tất cả (bao gồm dismissed)
npm run list -- --all

# Recency filter
npm run list -- --hot --days=7        # chỉ 7 ngày gần nhất
npm run list -- --all --days=90       # mở rộng ra 3 tháng

# Kết hợp filter
npm run list -- --hot --today --limit=10
npm run list -- --source=vitalik --limit=5
npm run list -- --state=new --today
```

Output mặc định (tiered):

```
HOT  🔥 (score 8+)
──────────────────────────────────────────────────────────────────────────────────────────
[9.1]   42  Base introduces new fee mechanism for...   Base Blog        2h ago
            → Compare with Arbitrum's approach and developer adoption impact
[8.5]   38  EigenLayer restaking hits $10B TVL amid..  The Block        5h ago
            → What restaking saturation means for ETH staking yields

OTHER  (score 6–7.9)
──────────────────────────────────────────────────────────────────────────────────────────
[7.2]   41  DeFi TVL reaches new high amid...          CoinDesk         3h ago
[6.8]   39  Kraken acquires...                         CoinDesk         6h ago

Showing 2 hot, 2 other (last 30 days). Use --days=N to change.
```

### Research Brief

```bash
# Generate brief cho article #42
npm run brief 42

# Bỏ qua cache + regenerate Sonnet + ghi đè file angle
npm run brief -- 42 --refresh
```

**One-time — vault template (Obsidian):**

```bash
mkdir -p ~/Dev/vault/templates ~/Dev/vault/projects/content-creator/angles
cp templates/angle-template.md ~/Dev/vault/templates/angle-template.md
```

Output:

```
══════════════════════════════════════════════════════════════
BRIEF #42 — Base introduces new fee mechanism
Source: Base Blog  |  Score: 9.1  |  Published: 2 days ago
URL: https://base.mirror.xyz/...
══════════════════════════════════════════════════════════════

WHY IT MATTERS
Base's new fee mechanism decouples L2 transaction costs from L1 gas
spikes, affecting all apps deployed on Base (~2,500 contracts).

RELATED STORIES (last 7 days)
  [8.5]  #38  EigenLayer restaking hits $10B TVL  —  5 days ago
  [7.2]  #41  DeFi TVL reaches new high           —  3 days ago

SUGGESTED ANGLES

  🇻🇳  Tiếng Việt
  1.  Fee mechanism mới của Base — template cho các L2 khác hay chỉ
      workaround cho vấn đề gas của riêng Base?
  2.  So sánh cách Base handle fee vs Arbitrum Nitro — cùng bài toán
      nhưng approach khác nhau hoàn toàn.

  🌐  English
  1.  Base's fee redesign: structural advantage for app-specific L2s
      or a band-aid for Ethereum's gas problem?

══════════════════════════════════════════════════════════════
Cost: $0.01  |  Sonnet: 1.2K in / 0.4K out tokens

💾  Saved: ~/Dev/vault/projects/content-creator/angles/2026-04-18-42-base-fee-mechanism.md
══════════════════════════════════════════════════════════════
```

Lần 2 chạy cùng article → dùng cache, không gọi API (file angle vẫn được ghi lại / overwrite cùng tên):

```
══════════════════════════════════════════════════════════════
(cached — no API call)

💾  Saved: ~/Dev/vault/projects/content-creator/angles/2026-04-18-42-base-fee-mechanism.md
══════════════════════════════════════════════════════════════
```

### Xem trạng thái nguồn

```bash
npm run sources:status
# Output:
# Sources status:
#
#   Source                    Status    Articles  Last article    Last fetch
#   ──────────────────────────────────────────────────────────────────────
#   Bankless                  enabled    243 arts  3h ago          2h ago
#   CoinDesk                  enabled    512 arts  1h ago          1h ago
#   Decrypt                   enabled    389 arts  2h ago          2h ago
#   CoinCu News               enabled     87 arts  5h ago          4h ago
#   Ethereum Foundation Blog  enabled     34 arts  3d ago          2h ago
#   Vitalik's Blog            enabled     12 arts  14d ago         2h ago
#   The Block                 disabled     0 arts  —               —
#   Base Blog                 disabled     0 arts  —               —
#   ...
```

### Test

```bash
npm test          # Chạy 39 tests
npm run test:watch  # Watch mode
```

---

## Project structure

```
src/
├── config/
│   ├── index.ts           # Load .env → Config; AI_MODELS (Haiku / Sonnet IDs)
│   ├── types.ts           # Config interface
│   └── rss-sources.ts     # Source of truth: 11 feeds (6 enabled) × 4 tiers
├── content-filter/
│   ├── index.ts           # filterNewArticles orchestrator (batch + state update)
│   ├── haiku-filter.ts    # Anthropic SDK — scoreArticles (batch 10, cost tracking)
│   └── types.ts           # ArticleToScore, FilterResult, BatchFilterResult
├── research-briefer/
│   ├── index.ts           # generateBrief orchestrator (load → related → Sonnet → cache → export angle)
│   ├── sonnet-briefer.ts  # Anthropic SDK — generateBriefWithSonnet (cost tracking)
│   ├── angle-exporter.ts # fill __KEY__ template → vault/angles/*.md
│   ├── formatter.ts       # printBrief — terminal output formatting
│   └── types.ts           # Brief, RelatedArticle, SuggestedAngles
├── database/
│   ├── index.ts           # Singleton DB connection (WAL, foreign keys)
│   ├── schema.ts          # CREATE TABLE × 7 + indexes
│   ├── migrations.ts      # Run schema + auto-migrate old tables
│   ├── types.ts           # ArticleState, Source, Article, ArticleStateRow
│   ├── sources.ts         # seedSources (upsert), getEnabledSources, getSourceBySlug
│   ├── articles.ts        # insertArticle (dedup), getArticlesWithFilter
│   ├── article-states.ts  # createArticleState, updateArticleState
│   ├── filter-results.ts  # insertFilterResult, isArticleScored, cacheArticleBrief, getCachedBrief
│   └── posts.ts           # insertPost, getPostsByPlatform, countTodayPosts
├── feed-fetcher/
│   ├── index.ts           # runFetch orchestrator (parallel + OG + scoring)
│   ├── rss-parser.ts      # fetchFeed → FeedItem[]
│   └── og-extractor.ts    # extractOgImageUrl → string | null
├── scripts/
│   ├── fetch.ts           # CLI: npm run fetch [--verbose]
│   ├── list.ts            # CLI: npm run list (tiered inbox, --days=N)
│   ├── brief.ts           # CLI: npm run brief <id> [--refresh]
│   └── sources-status.ts  # CLI: npm run sources:status (per-source health table)
└── utils/
    └── logger.ts          # Leveled, colored console logging
templates/
└── angle-template.md      # Copy to ~/Dev/vault/templates/angle-template.md
tests/
├── database.test.ts       # 8 tests: schema, posts CRUD
├── feed-fetcher.test.ts   # 14 tests: sources, articles, states, mocked fetch
├── content-filter.test.ts # 10 tests: filter DB, scoring, mocked Anthropic, fallback
└── research-briefer.test.ts # 7 tests: cache, related query, mocked Sonnet, fallback
```

---

## RSS Sources

| Tier | Nguồn | Loại | Ngôn ngữ | Tần suất | Status |
|------|-------|------|----------|----------|--------|
| 1 | Decrypt, Bankless, CoinDesk | crypto / defi | en | 1h | enabled |
| 1 | The Block | crypto | en | 1h | disabled — Cloudflare 403 |
| 2 | Ethereum Foundation, Vitalik's Blog | protocol | en | 1h | enabled |
| 2 | Base Blog | protocol | en | 1h | disabled — URL chết + Cloudflare |
| 3 | Coin68, CoinCu News, Tạp Chí Bitcoin | vietnamese | vi | 2h | CoinCu enabled; Coin68 + TCB disabled |
| 4 | MarkTechPost | ai | en | 2h | disabled |

Thêm/xóa/sửa nguồn: sửa file `src/config/rss-sources.ts` → thay đổi tự sync vào DB lần fetch tiếp.

---

## AI Scoring

Haiku scoring sử dụng hệ thống prompt tập trung vào focus areas:

| Score | Ý nghĩa | Hành động |
|-------|---------|-----------|
| 9.0–10.0 | Protocol update lớn, original research | HOT — hiện mặc định |
| 7.0–8.9 | Đáng viết take, có angle rõ ràng | HOT — hiện mặc định |
| 6.0–6.9 | Liên quan nhẹ, ít angle | OTHER — hiện khi `--other` |
| < 6 | Spam, listicle, price prediction | Auto-dismissed |

**Focus areas** (score cao hơn): L2/infrastructure, DeFi, SocialFi, AI×Crypto, developer tooling, Vietnamese crypto community.

**Penalty** (score thấp hơn): price analysis, celebrity endorsements, meme coins, exchange listings, airdrop guides.

**Chi phí thực tế**: ~$0.50 cho 1000 bài (Haiku pricing: $0.80/1M input, $4.00/1M output tokens).

## Research Brief

Sonnet brief cho mỗi article, cá nhân hóa theo voice/tone của user:

| Thành phần | Mô tả |
|-----------|--------|
| WHY IT MATTERS | 2–3 câu giải thích ý nghĩa, dùng số liệu cụ thể |
| RELATED STORIES | Tối đa 5 bài liên quan (7 ngày, score ≥ 6, cùng category/keyword) |
| SUGGESTED ANGLES | 2–3 góc VN + 1 góc EN tối đa; hook đầu dòng, 2–3 câu, không tóm tắt lại headline |
| Cache | Kết quả lưu trong `filter_results.ai_context` — lần 2 không gọi Sonnet; `--refresh` để gọi lại |
| Angle file | Markdown vào `~/Dev/vault/projects/content-creator/angles/YYYY-MM-DD-<id>-<slug>.md` (template `__KEY__`) |

**User context**: đọc động từ `~/Dev/projects/Content-Creator/about-me.md` + `tone-guidelines.md`. Không có file thì vẫn chạy (graceful fallback).

**Chi phí**: ~$0.01/brief (Sonnet pricing: $3.00/1M input, $15.00/1M output tokens).

---

## Roadmap

- [x] **Slice 1** — First Cast (DB schema, posts CRUD, config, logger)
- [x] **Slice 2** — First Fetch (RSS scrape → dedup → SQLite → OG image → CLI list)
- [x] **Slice 3** — Smart Filter (Claude Haiku scoring → tiered inbox, auto-dismiss, decimal scores, recency filter)
- [x] **Slice 4** — Research Brief (Claude Sonnet brief → WHY IT MATTERS + related stories + suggested angles, cache, user context)
- [x] **v0.2.0** — Feed fixes (disable The Block + Base Blog, Cloudflare-blocked), `npm run sources:status`, `--verbose` flag
- [ ] **Slice 5** — X API Adapter (publish to Twitter)
- [ ] **Slice 6** — TUI / Ink (interactive terminal UI)

---

## Troubleshooting

| Lỗi | Giải pháp |
|-----|-----------|
| `Missing required env var: ANTHROPIC_API_KEY` | Điền `ANTHROPIC_API_KEY` trong `.env` |
| Haiku/Sonnet API error / rate limit | Scoring bỏ qua — bài giữ state `new`; brief trả partial result |
| The Block / Base Blog không fetch được | Đã disabled do Cloudflare block — xem `npm run sources:status` |
| Feed timeout / 4xx errors | Bình thường — feed lỗi được bỏ qua, các nguồn khác vẫn chạy |
| `No scored articles found` | Chạy `npm run fetch` trước; dùng `--all` để xem tất cả kể cả chưa score |
| `Article #X not found` | Kiểm tra ID bằng `npm run list -- --all`; có thể article không tồn tại |
| `Article #X has not been scored yet` | Chạy `npm run fetch` để score article trước khi tạo brief |
| Brief hiện "(cached — no API call)" | Bình thường — brief đã cache; `npm run brief -- <id> --refresh` để gọi lại Sonnet |
| `Could not save angle file` / template not found | Copy `templates/angle-template.md` → `~/Dev/vault/templates/angle-template.md`; thư mục output được tạo tự động |
| DB migration log | Lần đầu chạy sau update sẽ thấy migration log — bình thường, tự xử lý |

---

## License

MIT

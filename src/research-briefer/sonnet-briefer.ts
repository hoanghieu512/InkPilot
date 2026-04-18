import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { AI_MODELS } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { Article } from '../database/types.js';
import type { FilterResultRow } from '../database/filter-results.js';
import type { RelatedArticle, SuggestedAngles, Brief } from './types.js';

const logger = createLogger('research-briefer:sonnet');

const SONNET_INPUT_PRICE_PER_TOKEN = 3.00 / 1_000_000;
const SONNET_OUTPUT_PRICE_PER_TOKEN = 15.00 / 1_000_000;

let clientInstance: Anthropic | null = null;

function getClient(): Anthropic {
  if (!clientInstance) {
    clientInstance = new Anthropic();
  }
  return clientInstance;
}

export function loadUserContext(): string {
  const aboutMePath = join(homedir(), 'Dev/projects/Content-Creator/about-me.md');
  const tonePath = join(homedir(), 'Dev/projects/Content-Creator/tone-guidelines.md');

  try {
    const aboutMe = readFileSync(aboutMePath, 'utf-8');
    const tone = readFileSync(tonePath, 'utf-8');
    return `## About the author\n${aboutMe}\n\n## Tone & voice guidelines\n${tone}`;
  } catch {
    logger.warn('Could not load user context files — brief will be generated without personalization');
    return '';
  }
}

function formatTimeAgo(dateStr: string | null): string {
  if (!dateStr) return 'unknown';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function buildSystemPrompt(userContext: string): string {
  return `You are a research assistant for a crypto content creator who posts on X (Twitter).

Your job: Given a crypto article and related context, generate a concise research brief
that helps the creator form their own personal take.

${userContext}

---

Output format — respond with JSON only, no markdown:
{
  "whyItMatters": "2-3 sentences explaining the significance. Be specific, use numbers/data if available. No fluff.",
  "suggestedAngles": {
    "vietnamese": [
      "Angle dạng seed thought — MAX 2-3 câu. Câu đầu phải có hook ngay (data point, hot take, hoặc câu hỏi khoét vào vấn đề). KHÔNG giải thích lại context đã biết. Viết như đang nhắn tin cho đồng nghiệp trong ngành.",
      "Angle thứ 2 — góc nhìn khác hoàn toàn (contrarian, comparative, hoặc implication cho airdrop/farming). Cũng max 2-3 câu."
    ],
    "english": [
      "1 angle max. Same rules — hook first, no context re-explanation, crypto-native casual."
    ]
  }
}

Rules:
- whyItMatters: no hype, no "this is revolutionary". Focus: what changed, who's affected, what's the implication.
- If related articles exist, reference them in angles where relevant.

ANGLE RULES (strict):
- Max 2-3 câu per angle. Nếu dài hơn → cắt.
- Câu đầu tiên phải là hook: số liệu cụ thể, hot take thẳng thắn, hoặc câu hỏi sharp.
- KHÔNG bắt đầu bằng: "Polymarket vừa...", "Dự án này...", "Đây là..." — tức là không tóm tắt lại tin tức.
- Angle là góc nhìn / câu hỏi để khai thác — không phải bản tóm tắt bài viết.
- Vietnamese angles: dùng slang tự nhiên (farm, airdrop, thesis, protocol, stack...), xưng "mình" nếu cần.
- English angles: casual professional, crypto native, skip basics.
- Nếu không có góc nào thực sự distinct → chỉ trả 1 angle, đừng ép ra 2.
- Do NOT write the post — just the angle/seed thought.

ANGLE VÍ DỤ TỐT:
"Poly V2 ra stablecoin riêng — vertical integration move quen thuộc. Câu hỏi thực là: họ có mở yield/airdrop cho LP không, hay chỉ là infra nội bộ?"

ANGLE VÍ DỤ TỆ (không làm theo):
"Polymarket vừa upgrade V2 với gas thấp hơn + tốc độ nhanh hơn, nhưng phần thú vị nhất là họ ra private label stablecoin riêng — tức là không còn phụ thuộc vào USDC/USDT nữa. Đây là pattern mà nhiều protocol lớn đang đi..."
→ Lý do tệ: Tóm tắt lại tin, không có hook, quá dài.`;
}

function buildUserPrompt(
  article: Article,
  filterResult: FilterResultRow,
  relatedArticles: RelatedArticle[],
): string {
  const relatedSection = relatedArticles.length > 0
    ? `\nRelated articles from the last 7 days:\n${relatedArticles.map(r => `- [${r.score.toFixed(1)}] "${r.title}" (${r.sourceName}, ${formatTimeAgo(r.publishedAt)})`).join('\n')}\n`
    : 'No related articles found in the last 7 days.';

  return `Article to brief:
Title: ${article.title}
Source: ${filterResult.category ?? 'Unknown'}
Published: ${article.published_at ?? 'Unknown'}
URL: ${article.url}
Content: ${article.content ?? article.summary ?? '(no snippet available)'}
AI Score: ${filterResult.score} — Category: ${filterResult.category ?? 'Unknown'}
Score reasoning: ${filterResult.reasoning ?? '(none)'}

${relatedSection}`;
}

interface SonnetBriefResponse {
  whyItMatters: string;
  suggestedAngles: {
    vietnamese: string[];
    english: string[];
  };
}

export async function generateBriefWithSonnet(
  article: Article,
  filterResult: FilterResultRow,
  sourceName: string,
  sourceSlug: string,
  relatedArticles: RelatedArticle[],
  userContext: string,
): Promise<Omit<Brief, 'cached'>> {
  const client = getClient();

  const systemPrompt = buildSystemPrompt(userContext);
  const userPrompt = buildUserPrompt(article, filterResult, relatedArticles);

  try {
    const response = await client.messages.create({
      model: AI_MODELS.sonnet,
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const tokensIn = response.usage.input_tokens;
    const tokensOut = response.usage.output_tokens;
    const costUsd = tokensIn * SONNET_INPUT_PRICE_PER_TOKEN + tokensOut * SONNET_OUTPUT_PRICE_PER_TOKEN;

    const textBlock = response.content.find((b) => b.type === 'text');
    let parsed: SonnetBriefResponse | null = null;

    if (textBlock && textBlock.type === 'text') {
      try {
        const rawText = textBlock.text.trim();
        const jsonText = rawText.startsWith('{') ? rawText : extractJsonObject(rawText);
        parsed = JSON.parse(jsonText) as SonnetBriefResponse;
      } catch {
        logger.warn('Failed to parse Sonnet JSON response');
      }
    }

    const angles: SuggestedAngles = parsed?.suggestedAngles ?? { vietnamese: [], english: [] };

    return {
      articleId: article.id,
      articleTitle: article.title,
      articleUrl: article.url,
      sourceSlug,
      sourceName,
      publishedAt: article.published_at ?? 'Unknown',
      score: filterResult.score,
      whyItMatters: parsed?.whyItMatters ?? '(Brief generation failed — could not parse response)',
      relatedArticles,
      suggestedAngles: angles,
      tokensIn,
      tokensOut,
      estimatedCostUsd: costUsd,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Sonnet API call failed: ${msg}`);

    return {
      articleId: article.id,
      articleTitle: article.title,
      articleUrl: article.url,
      sourceSlug,
      sourceName,
      publishedAt: article.published_at ?? 'Unknown',
      score: filterResult.score,
      whyItMatters: '(Brief generation failed — check API key)',
      relatedArticles,
      suggestedAngles: { vietnamese: [], english: [] },
    };
  }
}

function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return text;
  return text.slice(start, end + 1);
}

export { SONNET_INPUT_PRICE_PER_TOKEN, SONNET_OUTPUT_PRICE_PER_TOKEN };

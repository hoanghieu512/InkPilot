import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { ArticleToScore, FilterResult, BatchFilterResult } from './types.js';

const logger = createLogger('content-filter:haiku');

const HAIKU_INPUT_PRICE_PER_TOKEN = 0.80 / 1_000_000;
const HAIKU_OUTPUT_PRICE_PER_TOKEN = 4.00 / 1_000_000;

const SYSTEM_PROMPT = `You are a content filter for a crypto/Web3 researcher who writes personal takes on X (Twitter).

The researcher's focus areas (score higher):
- Layer 2 & infrastructure: Base, Optimism/OP Stack, Arbitrum, zkSync, ZK rollups, EIP proposals
- DeFi: Uniswap, Aave, liquid staking (Lido, EtherFi), EigenLayer/restaking, stablecoins
- SocialFi & decentralized social: Farcaster, Lens, Zora, AT Protocol
- AI × Crypto: on-chain AI agents, AI-powered DeFi, decentralized compute
- Developer tooling: smart contracts, Foundry, ethers.js, viem, wagmi
- Vietnamese crypto community news (if relevant to broader ecosystem)

Score LOWER (penalty):
- Pure price analysis / trading signals
- Celebrity endorsements
- Meme coin launches (unless significant ecosystem impact)
- Exchange listings
- Generic regulation news without specific policy detail
- "Top N coins to buy" listicles
- Airdrop farming guides
- Price prediction articles

Scoring rubric:
- 9.0-10.0: Significant protocol update, major ecosystem development, original research/analysis
- 7.0-8.9: Interesting development worth a take, clear angle exists, relevant to focus areas
- 5.0-6.9: Tangentially relevant, low angle potential
- 3.0-4.9: Mostly irrelevant to focus areas
- 0.0-2.9: Spam, listicle, price prediction, auto-dismissed

Return scores as decimals with one decimal place (e.g., 7.2, 8.5, 9.1), not integers. Use the full range within each tier — avoid rounding to whole numbers.

For Vietnamese articles: score based on significance to broader crypto ecosystem, not just local VN market.`;

interface HaikuResponseItem {
  id: number;
  score: number;
  category: string;
  reasoning: string;
  suggestedAngle: string;
}

let clientInstance: Anthropic | null = null;

function getClient(): Anthropic {
  if (!clientInstance) {
    clientInstance = new Anthropic();
  }
  return clientInstance;
}

export async function scoreArticles(
  articles: ArticleToScore[],
): Promise<BatchFilterResult> {
  if (articles.length === 0) {
    return { results: [], totalTokensIn: 0, totalTokensOut: 0, estimatedCostUsd: 0, hotCount: 0, otherCount: 0, dismissedCount: 0 };
  }

  const client = getClient();

  const articlesPayload = articles.map((a) => ({
    id: a.id,
    title: a.title,
    snippet: a.contentSnippet ?? '',
    source: a.sourceName,
    language: a.language,
  }));

  const userPrompt = `Score these ${articles.length} crypto articles for relevance to my research focus.

Respond with a JSON array only — no markdown, no explanation outside the JSON.

${JSON.stringify(articlesPayload, null, 2)}

Expected response format:
[
  {
    "id": 1,
    "score": 8.3,
    "category": "L2",
    "reasoning": "Brief explanation of the score.",
    "suggestedAngle": "One sentence starting point for personal take."
  }
]`;

  try {
    const response = await client.messages.create({
      model: AI_MODELS.haiku,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const tokensIn = response.usage.input_tokens;
    const tokensOut = response.usage.output_tokens;
    const costUsd = tokensIn * HAIKU_INPUT_PRICE_PER_TOKEN + tokensOut * HAIKU_OUTPUT_PRICE_PER_TOKEN;

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn('No text block in Haiku response — using fallback scores');
      return buildFallbackResult(articles, tokensIn, tokensOut, costUsd);
    }

    let parsed: unknown;
    try {
      const rawText = textBlock.text.trim();
      const jsonText = rawText.startsWith('[') ? rawText : extractJsonArray(rawText);
      parsed = JSON.parse(jsonText);
    } catch {
      logger.warn('Failed to parse Haiku JSON response — using fallback scores');
      return buildFallbackResult(articles, tokensIn, tokensOut, costUsd);
    }

    if (!Array.isArray(parsed)) {
      logger.warn('Haiku response is not an array — using fallback scores');
      return buildFallbackResult(articles, tokensIn, tokensOut, costUsd);
    }

    const results: FilterResult[] = [];
    const articleIds = new Set(articles.map((a) => a.id));

    for (const item of parsed as HaikuResponseItem[]) {
      if (!articleIds.has(item.id) || typeof item.score !== 'number') {
        logger.warn(`Skipping malformed result for article ${item.id}`);
        continue;
      }

      results.push({
        articleId: item.id,
        score: Math.max(0, Math.min(10, item.score)),
        category: item.category ?? 'unknown',
        reasoning: item.reasoning ?? '',
        suggestedAngle: item.suggestedAngle ?? '',
        tokensIn,
        tokensOut,
      });
    }

    let hotCount = 0;
    let otherCount = 0;
    let dismissedCount = 0;
    for (const r of results) {
      if (r.score >= 8) hotCount++;
      else if (r.score >= 6) otherCount++;
      else dismissedCount++;
    }

    return { results, totalTokensIn: tokensIn, totalTokensOut: tokensOut, estimatedCostUsd: costUsd, hotCount, otherCount, dismissedCount };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Haiku API call failed: ${msg}`);
    return { results: [], totalTokensIn: 0, totalTokensOut: 0, estimatedCostUsd: 0, hotCount: 0, otherCount: 0, dismissedCount: 0 };
  }
}

function extractJsonArray(text: string): string {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) return text;
  return text.slice(start, end + 1);
}

function buildFallbackResult(
  articles: ArticleToScore[],
  tokensIn: number,
  tokensOut: number,
  costUsd: number,
): BatchFilterResult {
  const results: FilterResult[] = articles.map((a) => ({
    articleId: a.id,
    score: 5,
    category: 'unknown',
    reasoning: 'Fallback score — Haiku response could not be parsed',
    suggestedAngle: '',
    tokensIn,
    tokensOut,
  }));

  return { results, totalTokensIn: tokensIn, totalTokensOut: tokensOut, estimatedCostUsd: costUsd, hotCount: 0, otherCount: results.length, dismissedCount: 0 };
}

export { HAIKU_INPUT_PRICE_PER_TOKEN, HAIKU_OUTPUT_PRICE_PER_TOKEN };

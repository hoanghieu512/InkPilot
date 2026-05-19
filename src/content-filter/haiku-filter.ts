import Anthropic from '@anthropic-ai/sdk';
import { AI_MODELS, SCORE_THRESHOLDS } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import type { ArticleToScore, FilterResult, BatchFilterResult } from './types.js';

const logger = createLogger('content-filter:haiku');

const HAIKU_INPUT_PRICE_PER_TOKEN = 0.80 / 1_000_000;
const HAIKU_OUTPUT_PRICE_PER_TOKEN = 4.00 / 1_000_000;

const SYSTEM_PROMPT = `You are a content filter for a crypto/Web3 content creator who writes personal takes on X (Twitter).

The creator publishes in three niches — score articles according to this priority stack:

PRIMARY focus — Security (~50% of content, score highest):
- Hacks, exploits, bridge attacks, protocol drains — especially with root-cause analysis or post-mortem
- Smart contract vulnerabilities, audit findings, critical bug disclosures
- Wallet security, phishing campaigns, social engineering, private key compromises
- Security tool releases, formal verification, bug bounty payouts, ZK proof vulnerabilities

SECONDARY focus — Tokenomics (~30% of content, score high):
- Token design decisions, emission schedules, vesting cliff analysis
- Staking economics, liquid staking (Lido, EtherFi, Rocket Pool), restaking (EigenLayer, Symbiotic)
- Protocol revenue models, fee mechanisms (EIP-1559, burn mechanics, fee switches)
- Treasury management, DAO funding decisions, token buy-backs, supply changes
- Points programs and airdrop design (mechanism critique, not farming guides)

TERTIARY focus — L1/L2 Infrastructure (~20% of content, score moderately high):
- Ethereum upgrades (Pectra, Fusaka, EIPs), Ethereum R&D and protocol research
- L2 rollups: Base, Arbitrum, Optimism/OP Stack, zkSync, StarkNet — upgrades, governance, sequencer changes
- Bitcoin protocol: Optech, taproot, Lightning Network, OP_CAT proposals
- Cross-chain infrastructure, data availability layers (EigenDA, Celestia), sequencer design
- MEV, PBS, shared sequencing — structural changes to block production

Score LOWER (penalty):
- Pure price analysis or trading signals with no structural insight
- Celebrity endorsements, influencer partnerships
- Meme coin launches (unless a clear security or tokenomics angle exists)
- Exchange listings, custody announcements, spot ETF noise
- "Top N coins to buy" listicles, airdrop farming guides
- Generic regulation news without specific enforcement action or policy detail
- Price predictions and TA articles

Scoring rubric:
- 9.0-10.0: Major security incident with meaningful analysis, landmark protocol upgrade, or structural tokenomics change with broad ecosystem impact
- 7.5-8.9: Clear development within the 3 niches — strong angle exists for a take
- 5.0-7.4: Tangentially relevant to niches, weak angle potential, or minor niche overlap
- 3.0-4.9: General crypto news outside the niches
- 0.0-2.9: Spam, listicles, price predictions, auto-dismissed

Return scores as decimals with one decimal place (e.g., 7.2, 8.5, 9.1), not integers. Use the full range within each tier — avoid rounding to whole numbers.

For Vietnamese articles: score based on significance to broader crypto ecosystem, not just local VN market.

For "category", you MUST return exactly one value from this fixed list — no other values allowed:
L2 | DeFi | AI x Crypto | Developer Tooling | SocialFi | Bitcoin | Regulation | Macro | Research/Protocol | Price/Trading | Exchange/Corporate | Other`;

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
]

IMPORTANT: "category" must be exactly one of: L2, DeFi, AI x Crypto, Developer Tooling, SocialFi, Bitcoin, Regulation, Macro, Research/Protocol, Price/Trading, Exchange/Corporate, Other`;

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
      if (r.score >= SCORE_THRESHOLDS.HOT) hotCount++;
      else if (r.score >= SCORE_THRESHOLDS.OTHER_MIN) otherCount++;
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

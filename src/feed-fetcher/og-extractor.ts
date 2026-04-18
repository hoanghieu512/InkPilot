import { createLogger } from '../utils/logger.js';

const logger = createLogger('feed-fetcher:og');

export async function extractOgImageUrl(articleUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);

    const response = await fetch(articleUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'InkPilot/0.1 OG Extractor',
        Accept: 'text/html',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();
    const match = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);

    if (match?.[1]) {
      logger.debug(`OG image found for ${articleUrl}`);
      return match[1];
    }

    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`OG extraction failed for ${articleUrl}: ${msg}`);
    return null;
  }
}

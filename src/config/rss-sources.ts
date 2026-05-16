export interface RssSourceConfig {
  slug: string;
  name: string;
  url: string;
  category: 'crypto' | 'protocol' | 'defi' | 'ai' | 'dev' | 'vietnamese' | 'protocol-l2' | 'research-technical';
  tier: 1 | 2 | 3 | 4;
  fetchIntervalHours: 1 | 2;
  enabled: boolean;
  language: 'en' | 'vi';
}

export const RSS_SOURCES: RssSourceConfig[] = [
  // Tier 1 — English crypto news (fetch every 1h)
  {
    slug: 'theblock',
    name: 'The Block',
    url: 'https://www.theblock.co/rss.xml',
    category: 'crypto',
    tier: 1,
    fetchIntervalHours: 1,
    // disabled: Cloudflare blocks all non-browser RSS requests (HTTP 403); no alternate endpoint found
    enabled: false,
    language: 'en',
  },
  {
    slug: 'decrypt',
    name: 'Decrypt',
    url: 'https://decrypt.co/feed',
    category: 'crypto',
    tier: 1,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },
  {
    slug: 'bankless',
    name: 'Bankless',
    url: 'https://www.bankless.com/feed',
    category: 'defi',
    tier: 1,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },
  {
    slug: 'coindesk',
    name: 'CoinDesk',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
    category: 'crypto',
    tier: 1,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },
  {
    slug: 'blockworks',
    name: 'Blockworks',
    url: 'https://blockworks.co/feed/',
    category: 'crypto',
    tier: 1,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },

  // Tier 1 — Research (fetch every 1h)
  {
    slug: 'ethresearch',
    name: 'ETH Research Forum',
    url: 'https://ethresear.ch/posts.rss',
    category: 'research-technical',
    tier: 1,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },
  {
    slug: 'bitcoinops',
    name: 'Bitcoin Optech',
    url: 'https://bitcoinops.org/feed.xml',
    category: 'research-technical',
    tier: 1,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },

  // Tier 2 — Protocol-specific (fetch every 1h)
  {
    slug: 'ethereum-foundation',
    name: 'Ethereum Foundation Blog',
    url: 'https://blog.ethereum.org/feed.xml',
    category: 'protocol',
    tier: 2,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },
  {
    slug: 'base-blog',
    name: 'Base Blog',
    // original base.mirror.xyz/feed.xml is dead (404); blog.base.org/feed requires Cloudflare JS challenge (403)
    url: 'https://blog.base.org/feed',
    category: 'protocol',
    tier: 2,
    fetchIntervalHours: 1,
    enabled: false,
    language: 'en',
  },
  {
    slug: 'optimism',
    name: 'Optimism Blog',
    url: 'https://optimism.mirror.xyz/feed',
    category: 'protocol-l2',
    tier: 2,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },
  {
    slug: 'arbitrum',
    name: 'Arbitrum Foundation',
    url: 'https://arbitrumfoundation.medium.com/feed',
    category: 'protocol-l2',
    tier: 2,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },

  // Tier 3 — Vietnamese crypto community (fetch every 2h)
  {
    slug: 'coincu',
    name: 'CoinCu News',
    url: 'https://coincu.com/feed/',
    category: 'vietnamese',
    tier: 3,
    fetchIntervalHours: 2,
    enabled: true,
    language: 'vi',
  },
];

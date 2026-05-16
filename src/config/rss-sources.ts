export interface RssSourceConfig {
  slug: string;
  name: string;
  url: string;
  /** Override for article URL domain when it differs from the feed URL's hostname. Used by repairArticleSourceIds. */
  articleDomain?: string;
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
    // optimism.mirror.xyz last updated 2025-06-12 (~11 months stale); no active RSS found on Paragraph or other platforms
    url: 'https://optimism.mirror.xyz/feed',
    category: 'protocol-l2',
    tier: 2,
    fetchIntervalHours: 1,
    enabled: false,
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

  // Disabled — retained for FK integrity (articles exist in DB from earlier fetches)
  {
    slug: 'vitalik',
    name: "Vitalik's Blog",
    url: 'https://vitalik.eth.limo/feed.xml',
    // article URLs are served from vitalik.ca (the feed host differs from article host)
    articleDomain: 'vitalik.ca',
    category: 'protocol',
    tier: 2,
    fetchIntervalHours: 1,
    enabled: false,
    language: 'en',
  },
  {
    slug: 'coin68',
    name: 'Coin68',
    url: 'https://coin68.com/feed/',
    category: 'vietnamese',
    tier: 3,
    fetchIntervalHours: 2,
    enabled: false,
    language: 'vi',
  },
  {
    slug: 'tapchibitcoin',
    name: 'Tạp Chí Bitcoin',
    url: 'https://tapchibitcoin.io/feed',
    category: 'vietnamese',
    tier: 3,
    fetchIntervalHours: 2,
    enabled: false,
    language: 'vi',
  },
  {
    slug: 'marktechpost',
    name: 'MarkTechPost',
    url: 'https://www.marktechpost.com/feed/',
    category: 'ai',
    tier: 4,
    fetchIntervalHours: 2,
    enabled: false,
    language: 'en',
  },
];

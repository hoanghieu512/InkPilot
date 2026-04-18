export interface RssSourceConfig {
  slug: string;
  name: string;
  url: string;
  category: 'crypto' | 'protocol' | 'defi' | 'ai' | 'dev' | 'vietnamese';
  tier: 1 | 2 | 3 | 4;
  fetchIntervalHours: 1 | 2;
  enabled: boolean;
  language: 'en' | 'vi';
}

export const RSS_SOURCES: RssSourceConfig[] = [
  // Tier 1 — English crypto (fetch every 1h)
  {
    slug: 'theblock',
    name: 'The Block',
    url: 'https://www.theblock.co/rss.xml',
    category: 'crypto',
    tier: 1,
    fetchIntervalHours: 1,
    enabled: true,
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
    slug: 'vitalik',
    name: "Vitalik's Blog",
    url: 'https://vitalik.eth.limo/feed.xml',
    category: 'protocol',
    tier: 2,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },
  {
    slug: 'base-blog',
    name: 'Base Blog',
    url: 'https://base.mirror.xyz/feed.xml',
    category: 'protocol',
    tier: 2,
    fetchIntervalHours: 1,
    enabled: true,
    language: 'en',
  },

  // Tier 3 — Vietnamese crypto community (fetch every 2h)
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
    slug: 'coincu',
    name: 'CoinCu News',
    url: 'https://coincu.com/feed/',
    category: 'vietnamese',
    tier: 3,
    fetchIntervalHours: 2,
    enabled: true,
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

  // Tier 4 — AI/Dev cross-domain (fetch every 2h)
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

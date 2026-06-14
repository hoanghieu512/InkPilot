export type Niche = 'security' | 'tokenomics' | 'l1l2' | 'other';

/** Fixed enum order — also the canonical order used in snapshot `byNiche`. */
export const NICHES: readonly Niche[] = ['security', 'tokenomics', 'l1l2', 'other'] as const;

export interface KolNicheConfig {
  /** X handle WITHOUT leading @, stored lowercase. */
  handle: string;
  niche: Niche;
}

// Synced BY HAND from ~/Dev/vault/projects/inkpilot/decisions/kol-reply-list.md.
// Re-edit this list when the vault list changes — there is no auto-parse.
export const KOL_NICHES: KolNicheConfig[] = [
  // Security
  { handle: 'samczsun', niche: 'security' },
  { handle: 'tayvano_', niche: 'security' },
  { handle: 'peckshieldalert', niche: 'security' },
  { handle: 'peckshield', niche: 'security' },
  { handle: 'slowmist', niche: 'security' },
  { handle: 'officer_cia', niche: 'security' },
  { handle: 'zachxbt', niche: 'security' },
  // Tokenomics / DeFi
  { handle: 'defiignas', niche: 'tokenomics' },
  { handle: 'stanikulechov', niche: 'tokenomics' },
  { handle: 'bantg', niche: 'tokenomics' },
  // L1/L2 infra
  { handle: '0xmert_', niche: 'l1l2' },
  { handle: 'aeyakovenko', niche: 'l1l2' },
  // Commentary / community → other
  { handle: 'cryptoteluguo', niche: 'other' },
  { handle: 'cobie', niche: 'other' },
  { handle: '5phutcrypto_', niche: 'other' },
  { handle: 'bachkhoabnb', niche: 'other' },
  { handle: 'thangonton', niche: 'other' },
  { handle: 'chanhdoro', niche: 'other' },
  { handle: 'trimaims', niche: 'other' },
  { handle: 'solotop999', niche: 'other' },
];

const NICHE_MAP = new Map<string, Niche>(
  KOL_NICHES.map((k) => [k.handle.toLowerCase(), k.niche]),
);

/** Look up a niche for a handle (with or without leading @, any case). Unknown → 'other'. */
export function lookupNiche(handle: string): Niche {
  const norm = handle.replace(/^@/, '').toLowerCase();
  return NICHE_MAP.get(norm) ?? 'other';
}

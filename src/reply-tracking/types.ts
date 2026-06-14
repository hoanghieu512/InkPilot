import type { Niche } from '../config/kol-niches.js';

/** One row from content-latest.csv, normalized. */
export interface ContentRow {
  postId: string;
  rawDate: string;
  postedDate: string; // YYYY-MM-DD
  postText: string;
  postLink: string;
  impressions: number;
  engagements: number;
  newFollows: number;
  isReply: boolean;
  kolHandle: string | null; // '@handle' as it appears, or null for originals
}

/** One row from overview-latest.csv, normalized. */
export interface OverviewRow {
  rawDate: string;
  date: string; // YYYY-MM-DD
  impressions: number;
  newFollows: number;
  unfollows: number;
}

export interface Period {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  label: string; // e.g. "Jun 1 – Jun 7, 2026"
}

/** Result of enriching one reply via TwitterAPI.io. Any field may be null on partial data. */
export interface ReplyEnrichment {
  replyCreatedAt: string | null;
  hour: number | null; // 0-23 in +07:00
  parentTweetId: string | null;
  parentImpressions: number | null;
  parentEngagements: number | null;
  parentAuthorHandle: string | null;
}

export type EnrichFn = (postId: string) => Promise<ReplyEnrichment>;

// ---- Snapshot (the Newsroom output contract) ----

export interface SnapshotSummary {
  replyCount: number;
  originalCount: number;
  replyImpShare: number;
  avgImpPerReply: number;
  avgImpPerOriginal: number;
  dudRate: number;
  newFollowsFromReply: number;
  newFollowsFromOriginal: number;
}

export interface SnapshotKol {
  handle: string;
  niche: Niche;
  replies: number;
  avgImp: number;
  totalImp: number;
  follows: number;
}

export interface SnapshotNiche {
  niche: Niche;
  replies: number;
  totalImp: number;
  avgImp: number;
}

export interface SnapshotHour {
  hour: number;
  replies: number;
  avgImp: number;
}

export interface SnapshotParentBucket {
  parentImpBand: '<1k' | '1k-10k' | '>10k';
  replies: number;
  avgReplyImp: number;
}

export interface SnapshotWeek {
  week: string; // YYYY-MM-DD (Monday)
  avgImpPerReply: number;
}

export interface ReplySnapshot {
  generatedAt: string;
  period: Period;
  summary: SnapshotSummary;
  byKol: SnapshotKol[];
  byNiche: SnapshotNiche[];
  byHour: SnapshotHour[];
  parentSizeCorrelation: {
    note: string;
    buckets: SnapshotParentBucket[];
  };
  weeklyTrend: SnapshotWeek[];
}

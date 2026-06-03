/**
 * GitHub Memory System — Shared types
 */

// ── Ingestion Job ──

export type IngestionStatus =
  | "queued"
  | "scanning"
  | "partially_completed"
  | "retrying"
  | "rate_limited"
  | "paused"
  | "failed"
  | "completed"
  | "continuously_syncing"
  | "cancelled";

export type IngestionStage =
  | "repos"
  | "commits"
  | "prs"
  | "issues"
  | "contributions"
  | "collaborators"
  | "graph"
  | "expertise"
  | "embeddings";

export interface IngestionCheckpoint {
  /** Current stage being processed */
  currentStage?: IngestionStage;
  /** Per-stage cursor: repo page, commit page per repo, etc. */
  repos?: { page: number; done: boolean };
  commits?: { repoIndex: number; page: number; done: boolean };
  prs?: { repoIndex: number; page: number; done: boolean };
  issues?: { repoIndex: number; page: number; done: boolean };
  contributions?: { done: boolean };
  collaborators?: { done: boolean };
  graph?: { done: boolean };
  expertise?: { done: boolean };
  embeddings?: { repoIndex: number; prIndex: number; issueIndex: number; done: boolean };
}

export interface IngestionJob {
  id: string;
  userId: string;
  status: IngestionStatus;
  githubUsername: string;
  checkpoint: IngestionCheckpoint;
  completedStages: IngestionStage[];
  retryCount: number;
  maxRetries: number;
  lastError: string | null;
  lastErrorAt: string | null;
  nextRetryAt: string | null;
  reposProcessed: number;
  commitsProcessed: number;
  prsProcessed: number;
  issuesProcessed: number;
  totalEntities: number;
  totalEmbeddings: number;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string;
  createdAt: string;
}

// ── GitHub API response types ──

export interface GHRepo {
  id: number;
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  fork: boolean;
  archived: boolean;
  private: boolean;
  owner: { login: string };
  language: string | null;
  languages_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  size: number;
  default_branch: string;
  topics: string[];
  pushed_at: string;
  created_at: string;
  updated_at: string;
}

export interface GHCommit {
  sha: string;
  commit: {
    message: string;
    author: { date: string; name: string; email: string };
  };
  stats?: { additions: number; deletions: number; total: number };
  files?: { filename: string; additions: number; deletions: number }[];
}

export interface GHPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  merged_at: string | null;
  closed_at: string | null;
  created_at: string;
  user: { login: string };
  additions: number;
  deletions: number;
  changed_files: number;
  comments: number;
  review_comments: number;
  commits: number;
  labels: { name: string }[];
}

export interface GHIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  closed_at: string | null;
  created_at: string;
  user: { login: string };
  labels: { name: string }[];
  assignees: { login: string }[];
  comments: number;
  pull_request?: unknown; // If present, it's a PR, not an issue
}

export interface GHEvent {
  type: string;
  repo: { name: string };
  created_at: string;
  payload?: Record<string, unknown>;
}

// ── Stored types ──

export interface GitHubMemoryRepo {
  id: string;
  userId: string;
  githubId: number;
  fullName: string;
  name: string;
  description: string | null;
  htmlUrl: string;
  isFork: boolean;
  isArchived: boolean;
  isPrivate: boolean;
  ownerLogin: string;
  role: "owner" | "contributor" | "member" | "forked";
  primaryLanguage: string | null;
  languages: Record<string, number>;
  topics: string[];
  stargazersCount: number;
  forksCount: number;
  openIssuesCount: number;
  sizeKb: number;
  defaultBranch: string;
  pushedAt: string | null;
  readmeSummary: string | null;
  inferredFrameworks: string[];
  importanceScore: number;
  lastSyncedAt: string;
}

export interface GitHubExpertise {
  skill: string;
  skillCategory: "language" | "framework" | "tool" | "domain" | "pattern" | "platform";
  confidence: number;
  evidenceRepos: number;
  evidenceCommits: number;
  evidencePrs: number;
  totalLines: number;
  yearsActive: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface GitHubGraphEdge {
  sourceType: string;
  sourceName: string;
  relationship: string;
  targetType: string;
  targetName: string;
  strength: number;
  evidenceCount: number;
}

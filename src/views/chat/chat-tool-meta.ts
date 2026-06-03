import type { ElementType } from "react";

import {
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  Bookmark,
  Bot,
  Briefcase,
  Bug,
  Building2,
  CheckCircle2,
  Clock,
  Code2,
  FileEdit,
  FileText,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Github,
  Globe,
  LayoutDashboard,
  Mail,
  MailOpen,
  MessageSquare,
  Network,
  Play,
  Search,
  Shield,
  Sparkles,
  Star,
  Tag,
  Terminal,
  Trash2,
  Users,
} from "lucide-react";

export type ToolMeta = { icon: ElementType; label: string; activeLabel: string };

// ─────────────────────────────────────────────────────────────────────────────
// Tool Metadata
// ─────────────────────────────────────────────────────────────────────────────

export const TOOL_META: Record<string, ToolMeta> = {

  inboxRag: {
    icon: Search,
    label: "Searched emails",
    activeLabel: "Searching emails...",
  },
  buildGmailSearchQuery: {
    icon: Search,
    label: "Built search query",
    activeLabel: "Building search query...",
  },
  getThread: {
    icon: Mail,
    label: "Fetched thread",
    activeLabel: "Fetching thread...",
  },
  getThreadSummary: {
    icon: Mail,
    label: "Summarized thread",
    activeLabel: "Summarizing thread...",
  },
  sendEmail: {
    icon: Mail,
    label: "Sent email",
    activeLabel: "Sending email...",
  },
  composeEmail: {
    icon: FileEdit,
    label: "Composed draft",
    activeLabel: "Composing draft...",
  },
  bulkArchive: {
    icon: Archive,
    label: "Archived threads",
    activeLabel: "Archiving threads...",
  },
  bulkDelete: {
    icon: Trash2,
    label: "Deleted threads",
    activeLabel: "Deleting threads...",
  },
  markThreadsRead: {
    icon: MailOpen,
    label: "Marked as read",
    activeLabel: "Marking as read...",
  },
  markThreadsUnread: {
    icon: MailOpen,
    label: "Marked as unread",
    activeLabel: "Marking as unread...",
  },
  modifyLabels: {
    icon: Tag,
    label: "Modified labels",
    activeLabel: "Modifying labels...",
  },
  getUserLabels: {
    icon: Tag,
    label: "Fetched labels",
    activeLabel: "Fetching labels...",
  },
  createLabel: {
    icon: Tag,
    label: "Created label",
    activeLabel: "Creating label...",
  },
  deleteLabel: {
    icon: Tag,
    label: "Deleted label",
    activeLabel: "Deleting label...",
  },
  getCurrentDate: {
    icon: Clock,
    label: "Got current date",
    activeLabel: "Getting date...",
  },
  webSearch: {
    icon: Globe,
    label: "Searched the web",
    activeLabel: "Searching the web...",
  },
  searchJobs: {
    icon: Briefcase,
    label: "Found jobs",
    activeLabel: "Searching jobs & reading full descriptions...",
  },
  evaluateJob: {
    icon: Briefcase,
    label: "Evaluated job",
    activeLabel: "Running 3-layer evaluation (archetype + match + gaps + ghost)...",
  },
  generateApplicationPackage: {
    icon: Briefcase,
    label: "Generated application package",
    activeLabel: "Tailoring resume, cover letter, and outreach...",
  },
  trackJobApplication: {
    icon: Briefcase,
    label: "Updated application status",
    activeLabel: "Saving application outcome...",
  },
  // GitHub MCP tools
  get_me: {
    icon: Github,
    label: "Fetched GitHub profile",
    activeLabel: "Fetching GitHub profile...",
  },
  list_repos: {
    icon: FolderGit2,
    label: "Listed repositories",
    activeLabel: "Listing repositories...",
  },
  search_repos: {
    icon: Search,
    label: "Searched repositories",
    activeLabel: "Searching repositories...",
  },
  get_repo: {
    icon: FolderGit2,
    label: "Fetched repository",
    activeLabel: "Fetching repository...",
  },
  list_issues: {
    icon: Bug,
    label: "Listed issues",
    activeLabel: "Listing issues...",
  },
  create_issue: {
    icon: Bug,
    label: "Created issue",
    activeLabel: "Creating issue...",
  },
  list_pull_requests: {
    icon: GitPullRequest,
    label: "Listed pull requests",
    activeLabel: "Listing pull requests...",
  },
  create_pull_request: {
    icon: GitPullRequest,
    label: "Created pull request",
    activeLabel: "Creating pull request...",
  },
  list_branches: {
    icon: GitBranch,
    label: "Listed branches",
    activeLabel: "Listing branches...",
  },
  search_code: {
    icon: Search,
    label: "Searched code",
    activeLabel: "Searching code...",
  },
  get_file_contents: {
    icon: FileEdit,
    label: "Fetched file",
    activeLabel: "Fetching file...",
  },
  // GitHub Actions tools
  actions_get: {
    icon: Play,
    label: "Fetched workflow details",
    activeLabel: "Fetching workflow...",
  },
  actions_list: {
    icon: Play,
    label: "Listed workflows",
    activeLabel: "Listing workflows...",
  },
  actions_run_trigger: {
    icon: Play,
    label: "Triggered workflow",
    activeLabel: "Triggering workflow...",
  },
  get_job_logs: {
    icon: Play,
    label: "Fetched job logs",
    activeLabel: "Fetching job logs...",
  },
  // Discussions tools
  get_discussion: {
    icon: MessageSquare,
    label: "Fetched discussion",
    activeLabel: "Fetching discussion...",
  },
  list_discussions: {
    icon: MessageSquare,
    label: "Listed discussions",
    activeLabel: "Listing discussions...",
  },
  get_discussion_comments: {
    icon: MessageSquare,
    label: "Fetched comments",
    activeLabel: "Fetching comments...",
  },
  list_discussion_categories: {
    icon: MessageSquare,
    label: "Listed categories",
    activeLabel: "Listing categories...",
  },
  // Notification tools
  list_notifications: {
    icon: Bell,
    label: "Listed notifications",
    activeLabel: "Listing notifications...",
  },
  dismiss_notification: {
    icon: Bell,
    label: "Dismissed notification",
    activeLabel: "Dismissing notification...",
  },
  mark_all_notifications_read: {
    icon: Bell,
    label: "Marked all read",
    activeLabel: "Marking all read...",
  },
  // Gist tools
  create_gist: {
    icon: Bookmark,
    label: "Created gist",
    activeLabel: "Creating gist...",
  },
  get_gist: {
    icon: Bookmark,
    label: "Fetched gist",
    activeLabel: "Fetching gist...",
  },
  list_gists: {
    icon: Bookmark,
    label: "Listed gists",
    activeLabel: "Listing gists...",
  },
  // Security tools
  list_code_scanning_alerts: {
    icon: Shield,
    label: "Listed code alerts",
    activeLabel: "Listing code alerts...",
  },
  get_code_scanning_alert: {
    icon: Shield,
    label: "Fetched code alert",
    activeLabel: "Fetching code alert...",
  },
  list_dependabot_alerts: {
    icon: Shield,
    label: "Listed Dependabot alerts",
    activeLabel: "Listing Dependabot alerts...",
  },
  get_dependabot_alert: {
    icon: Shield,
    label: "Fetched Dependabot alert",
    activeLabel: "Fetching Dependabot alert...",
  },
  list_secret_scanning_alerts: {
    icon: Shield,
    label: "Listed secret alerts",
    activeLabel: "Listing secret alerts...",
  },
  // Projects tools
  projects_get: {
    icon: LayoutDashboard,
    label: "Fetched project",
    activeLabel: "Fetching project...",
  },
  projects_list: {
    icon: LayoutDashboard,
    label: "Listed projects",
    activeLabel: "Listing projects...",
  },
  projects_write: {
    icon: LayoutDashboard,
    label: "Updated project",
    activeLabel: "Updating project...",
  },
  // Organization tools
  search_orgs: {
    icon: Building2,
    label: "Searched organizations",
    activeLabel: "Searching organizations...",
  },
  // Copilot tools
  assign_copilot_to_issue: {
    icon: Sparkles,
    label: "Assigned Copilot",
    activeLabel: "Assigning Copilot...",
  },
  request_copilot_review: {
    icon: Sparkles,
    label: "Requested Copilot review",
    activeLabel: "Requesting review...",
  },
  create_pull_request_with_copilot: {
    icon: Sparkles,
    label: "Copilot creating PR",
    activeLabel: "Copilot working...",
  },
  // Git tree
  get_repository_tree: {
    icon: FolderGit2,
    label: "Fetched repo tree",
    activeLabel: "Fetching repo tree...",
  },
  // Stargazers
  star_repository: {
    icon: Star,
    label: "Starred repository",
    activeLabel: "Starring repository...",
  },
  unstar_repository: {
    icon: Star,
    label: "Unstarred repository",
    activeLabel: "Unstarring repository...",
  },
  list_starred_repositories: {
    icon: Star,
    label: "Listed starred repos",
    activeLabel: "Listing starred repos...",
  },
  // Users
  search_users: {
    icon: Users,
    label: "Searched users",
    activeLabel: "Searching users...",
  },
  // Repository tools
  create_repository: {
    icon: FolderGit2,
    label: "Created repository",
    activeLabel: "Creating repository...",
  },
  fork_repository: {
    icon: FolderGit2,
    label: "Forked repository",
    activeLabel: "Forking repository...",
  },
  list_commits: {
    icon: GitBranch,
    label: "Listed commits",
    activeLabel: "Listing commits...",
  },
  get_commit: {
    icon: GitBranch,
    label: "Fetched commit",
    activeLabel: "Fetching commit...",
  },
  push_files: {
    icon: FolderGit2,
    label: "Pushed files",
    activeLabel: "Pushing files...",
  },
  create_or_update_file: {
    icon: FileEdit,
    label: "Updated file",
    activeLabel: "Updating file...",
  },
  list_releases: {
    icon: Tag,
    label: "Listed releases",
    activeLabel: "Listing releases...",
  },
  list_tags: {
    icon: Tag,
    label: "Listed tags",
    activeLabel: "Listing tags...",
  },
  // Issue tools
  issue_read: {
    icon: Bug,
    label: "Read issue",
    activeLabel: "Reading issue...",
  },
  issue_write: {
    icon: Bug,
    label: "Updated issue",
    activeLabel: "Updating issue...",
  },
  add_issue_comment: {
    icon: Bug,
    label: "Added comment",
    activeLabel: "Adding comment...",
  },
  search_issues: {
    icon: Bug,
    label: "Searched issues",
    activeLabel: "Searching issues...",
  },
  // PR tools
  pull_request_read: {
    icon: GitPullRequest,
    label: "Read pull request",
    activeLabel: "Reading pull request...",
  },
  merge_pull_request: {
    icon: GitPullRequest,
    label: "Merged pull request",
    activeLabel: "Merging pull request...",
  },
  update_pull_request: {
    icon: GitPullRequest,
    label: "Updated pull request",
    activeLabel: "Updating pull request...",
  },
  search_pull_requests: {
    icon: GitPullRequest,
    label: "Searched pull requests",
    activeLabel: "Searching pull requests...",
  },
  // Label tools
  label_write: {
    icon: Tag,
    label: "Updated label",
    activeLabel: "Updating label...",
  },
  list_label: {
    icon: Tag,
    label: "Listed labels",
    activeLabel: "Listing labels...",
  },
  get_label: {
    icon: Tag,
    label: "Fetched label",
    activeLabel: "Fetching label...",
  },
  // GitHub support docs
  github_support_docs_search: {
    icon: BookOpen,
    label: "Searched GitHub docs",
    activeLabel: "Searching GitHub docs...",
  },
  // GitMCP documentation tools
  fetch_generic_documentation: {
    icon: BookOpen,
    label: "Fetched documentation",
    activeLabel: "Fetching documentation...",
  },
  search_generic_documentation: {
    icon: BookOpen,
    label: "Searched documentation",
    activeLabel: "Searching documentation...",
  },
  search_generic_code: {
    icon: Code2,
    label: "Searched code",
    activeLabel: "Searching code...",
  },
  fetch_url_content: {
    icon: Globe,
    label: "Fetched URL content",
    activeLabel: "Fetching URL content...",
  },
  // Draw.io MCP tools
  create_diagram: {
    icon: Network,
    label: "Created diagram",
    activeLabel: "Drawing diagram...",
  },
  search_shapes: {
    icon: Search,
    label: "Searched shapes",
    activeLabel: "Searching shapes...",
  },
  // OpenUI Report tool
  generate_visual_report: {
    icon: BarChart3,
    label: "Generated visual report",
    activeLabel: "Generating visual report...",
  },
  // Portfolio chatbot on-demand GitHub tools
  get_repo_file_tree: {
    icon: FolderGit2,
    label: "Fetched file tree",
    activeLabel: "Fetching file tree...",
  },
  get_file_content: {
    icon: FileEdit,
    label: "Fetched file content",
    activeLabel: "Fetching file content...",
  },
  get_repo_details: {
    icon: FolderGit2,
    label: "Fetched repo details",
    activeLabel: "Fetching repo details...",
  },
  // Repo Agent tools (ephemeral vector index + sandbox)
  search_repo_code: {
    icon: Search,
    label: "Searched repository code",
    activeLabel: "🔍 Searching indexed codebase...",
  },
  get_repo_structure: {
    icon: FolderGit2,
    label: "Fetched repo structure",
    activeLabel: "📂 Loading file tree & configs...",
  },
  read_repo_file: {
    icon: FileEdit,
    label: "Read repository file",
    activeLabel: "📄 Reading file from sandbox...",
  },
};

export function formatToolName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

export function getToolMeta(name: string) {
  if (TOOL_META[name]) return TOOL_META[name];

  // Pattern-based fallback for any unlisted GitHub MCP / GitMCP tools
  const n = name.toLowerCase();
  const label = formatToolName(name);
  const activeLabel = `Running ${name.replace(/_/g, " ")}...`;

  if (n.includes("action") || n.includes("workflow") || n.includes("job_log"))
    return { icon: Play, label, activeLabel };
  if (n.includes("issue") || n.includes("sub_issue"))
    return { icon: Bug, label, activeLabel };
  if (n.includes("pull_request") || n.includes("merge") || n.includes("pending_review"))
    return { icon: GitPullRequest, label, activeLabel };
  if (n.includes("discussion"))
    return { icon: MessageSquare, label, activeLabel };
  if (n.includes("notification"))
    return { icon: Bell, label, activeLabel };
  if (n.includes("gist"))
    return { icon: Bookmark, label, activeLabel };
  if (n.includes("security") || n.includes("scanning") || n.includes("dependabot") || n.includes("advisory"))
    return { icon: Shield, label, activeLabel };
  if (n.includes("project"))
    return { icon: LayoutDashboard, label, activeLabel };
  if (n.includes("label"))
    return { icon: Tag, label, activeLabel };
  if (n.includes("org"))
    return { icon: Building2, label, activeLabel };
  if (n.includes("copilot"))
    return { icon: Sparkles, label, activeLabel };
  if (n.includes("star"))
    return { icon: Star, label, activeLabel };
  if (n.includes("user") || n.includes("team") || n === "get_me")
    return { icon: Users, label, activeLabel };
  if (n.includes("repo") || n.includes("branch") || n.includes("commit") || n.includes("release") || n.includes("tag") || n.includes("file") || n.includes("push") || n.includes("fork") || n.includes("tree"))
    return { icon: FolderGit2, label, activeLabel };
  if (n.includes("documentation") || n.includes("docs"))
    return { icon: BookOpen, label, activeLabel };
  if (n.includes("search") || n.includes("code"))
    return { icon: Search, label, activeLabel };

  return { icon: CheckCircle2, label: name, activeLabel: `Running ${name}...` };
}

export const CHAT_MODEL_OPTIONS = [
  {
    value: "pioneer-default",
    label: "DeepSeek V4 Flash",
    description: "Pioneer AI — 284B MoE, 1M context",
  },
] as const;

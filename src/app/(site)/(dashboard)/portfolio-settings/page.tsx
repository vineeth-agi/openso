"use client";

import { useState, useEffect, useCallback, useRef } from "react";

import Link from "next/link";

import {
  Loader2,
  CheckCircle2,
  ExternalLink,
  Globe,
  Github,
  FileText,
  Sparkles,
  Eye,
  EyeOff,
  Copy,
  Check,
  AlertCircle,
  Briefcase,
  Code2,
  User,
  Mail,
  Link2,
  Calendar,
  ImageIcon,
  Plus,
  Trash2,
  Save,
  GripVertical,
  Award,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

// ── Types ────────────────────────────────────────────────────────────────────

interface ProfileStatus {
  hasResume: boolean;
  hasGitHub: boolean;
  githubConnected: boolean;
  githubUsername: string | null;
}

interface SiteConfigProject {
  title: string;
  category: string;
  description: string;
  techstacks: string[];
  status: string;
  link: string | null;
  github: string | null;
  _editorId?: string;
}

interface SiteConfigExperience {
  role: string;
  year: string;
  company: string;
  type: string;
  location: string;
  techstacks?: string[];
  responsibility?: { text: string; bold?: boolean }[][];
  _editorId?: string;
}

interface SiteConfigHackathon {
  title: string;
  event: string;
  year: string;
  placement: string | null;
  college: string | null;
  body: { text: string; bold?: boolean }[];
  techstacks: string[];
  link: string | null;
  _editorId?: string;
}

interface SiteConfigResearch {
  title: string;
  year: string;
  authors?: string[];
  venue?: string;
  link?: string;
  description?: string;
  _editorId?: string;
}

interface SiteConfigIdentity {
  name: string;
  firstName: string;
  title: string;
  tagline: string;
  bio: string;
  intros: string[];
}

interface SiteConfigContact {
  email: string | null;
  url: string | null;
  calUrl: string | null;
  resumeUrl: string | null;
}

interface SiteConfigSocial {
  label: string;
  username: string;
  url: string;
}

interface SiteConfigSocials {
  github: SiteConfigSocial | null;
  twitter: SiteConfigSocial | null;
  linkedin: SiteConfigSocial | null;
  leetcode: SiteConfigSocial | null;
  tryhackme: SiteConfigSocial | null;
  codeforces: SiteConfigSocial | null;
}

interface SiteConfig {
  identity: SiteConfigIdentity;
  contact: SiteConfigContact;
  socials: SiteConfigSocials;
  projects: SiteConfigProject[];
  experiences: SiteConfigExperience[];
  hackathons: SiteConfigHackathon[];
  research: SiteConfigResearch[];
  [key: string]: unknown;
}

interface PortfolioRow {
  id: string;
  username: string | null;
  site_config: SiteConfig | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  tech_stack: string[] | null;
  years_experience: number | null;
  config_generated_at: string | null;
  is_published: boolean;
  published_at: string | null;
}

// ── Markdown Bold Segments Parsing Helpers ─────────────────────────────────────

function parseMarkdownToSegments(line: string): { text: string; bold?: boolean }[] {
  if (!line) return [];
  const parts = line.split("**");
  return parts.map((part, index) => {
    const isBold = index % 2 === 1;
    return isBold ? { text: part, bold: true } : { text: part };
  }).filter(seg => seg.text !== "");
}

function parseSegmentsToMarkdown(bullets: { text: string; bold?: boolean }[][]): string {
  if (!bullets || !Array.isArray(bullets)) return "";
  return bullets
    .map((bullet) => {
      if (!Array.isArray(bullet)) return "";
      return bullet
        .map((seg) => (seg.bold ? `**${seg.text}**` : seg.text))
        .join("");
    })
    .filter(Boolean)
    .join("\n");
}

function parseMarkdownTo1DSegments(text: string): { text: string; bold?: boolean }[] {
  return parseMarkdownToSegments(text);
}

function parse1DSegmentsToMarkdown(segments: { text: string; bold?: boolean }[]): string {
  if (!segments || !Array.isArray(segments)) return "";
  return segments.map((seg) => (seg.bold ? `**${seg.text}**` : seg.text)).join("");
}

// ── Section Editor Components ─────────────────────────────────────────────

function IdentityEditor({
  identity,
  onChange,
}: {
  identity: SiteConfigIdentity;
  onChange: (i: SiteConfigIdentity) => void;
}) {
  const update = (field: keyof SiteConfigIdentity, value: string | string[]) =>
    onChange({ ...identity, [field]: value });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Full Name</Label>
          <Input
            value={identity.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="John Doe"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">First Name</Label>
          <Input
            value={identity.firstName}
            onChange={(e) => update("firstName", e.target.value)}
            placeholder="John"
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Job Title</Label>
          <Input
            value={identity.title}
            onChange={(e) => update("title", e.target.value)}
            placeholder="Full Stack Engineer"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Tagline</Label>
          <Input
            value={identity.tagline}
            onChange={(e) => update("tagline", e.target.value)}
            placeholder="MS CS @ MIT"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Bio</Label>
        <Textarea
          value={identity.bio}
          onChange={(e) => update("bio", e.target.value)}
          placeholder="2-3 sentence professional summary..."
          className="min-h-20"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Intro Labels (comma-separated)</Label>
        <Input
          value={identity.intros.join(", ")}
          onChange={(e) =>
            update(
              "intros",
              e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            )
          }
          placeholder="Software Engineer, Open Source Builder, Problem Solver"
        />
        <p className="text-[10px] text-muted-foreground">Rotating labels shown on your portfolio hero</p>
      </div>
    </div>
  );
}

function ContactEditor({
  contact,
  onChange,
}: {
  contact: SiteConfigContact;
  onChange: (c: SiteConfigContact) => void;
}) {
  const update = (field: keyof SiteConfigContact, value: string) =>
    onChange({ ...contact, [field]: value || null });

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5">
            <Mail className="h-3 w-3" /> Email
          </Label>
          <Input
            type="email"
            value={contact.email || ""}
            onChange={(e) => update("email", e.target.value)}
            placeholder="john@example.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5">
            <Link2 className="h-3 w-3" /> Website
          </Label>
          <Input
            value={contact.url || ""}
            onChange={(e) => update("url", e.target.value)}
            placeholder="https://johndoe.dev"
          />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5">
            <Calendar className="h-3 w-3" /> Calendar URL
          </Label>
          <Input
            value={contact.calUrl || ""}
            onChange={(e) => update("calUrl", e.target.value)}
            placeholder="https://cal.com/john"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs flex items-center gap-1.5">
            <FileText className="h-3 w-3" /> Resume URL
          </Label>
          <Input
            value={contact.resumeUrl || ""}
            onChange={(e) => update("resumeUrl", e.target.value)}
            placeholder="https://example.com/resume.pdf"
          />
        </div>
      </div>
    </div>
  );
}

function SocialsEditor({
  socials,
  onChange,
}: {
  socials: SiteConfigSocials;
  onChange: (s: SiteConfigSocials) => void;
}) {
  const platforms = [
    { key: "github" as const, label: "GitHub", icon: <Github className="h-3.5 w-3.5" />, urlPrefix: "https://github.com/" },
    { key: "linkedin" as const, label: "LinkedIn", icon: <Briefcase className="h-3.5 w-3.5" />, urlPrefix: "https://www.linkedin.com/in/" },
    { key: "twitter" as const, label: "Twitter/X", icon: <Globe className="h-3.5 w-3.5" />, urlPrefix: "https://x.com/" },
    { key: "leetcode" as const, label: "LeetCode", icon: <Code2 className="h-3.5 w-3.5" />, urlPrefix: "https://leetcode.com/" },
    { key: "tryhackme" as const, label: "TryHackMe", icon: <Globe className="h-3.5 w-3.5" />, urlPrefix: "https://tryhackme.com/p/" },
    { key: "codeforces" as const, label: "Codeforces", icon: <Code2 className="h-3.5 w-3.5" />, urlPrefix: "https://codeforces.com/profile/" },
  ];

  return (
    <div className="space-y-3">
      {platforms.map(({ key, label, icon, urlPrefix }) => (
        <div key={key} className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 w-24 shrink-0">
            {icon}
            <span className="text-xs font-medium">{label}</span>
          </div>
          <Input
            value={socials[key]?.username || ""}
            onChange={(e) => {
              const username = e.target.value.trim();
              onChange({
                ...socials,
                [key]: username
                  ? { label, username, url: urlPrefix + username }
                  : null,
              });
            }}
            placeholder="username"
            className="text-sm h-8"
          />
        </div>
      ))}
    </div>
  );
}

function ProjectEditor({
  project,
  index,
  onChange,
  onRemove,
}: {
  project: SiteConfigProject;
  index: number;
  onChange: (p: SiteConfigProject) => void;
  onRemove: () => void;
}) {
  const update = (field: keyof SiteConfigProject, value: unknown) =>
    onChange({ ...project, [field]: value });

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-muted-foreground">#{index + 1}</span>
          <span>Project</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Title</Label>
          <Input value={project.title} onChange={(e) => update("title", e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Category</Label>
          <Input value={project.category} onChange={(e) => update("category", e.target.value)} placeholder="SaaS, Open Source" className="h-8 text-sm" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Textarea value={project.description} onChange={(e) => update("description", e.target.value)} className="min-h-14 text-sm" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={project.status} onValueChange={(v) => update("status", v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="building">Building</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Link</Label>
          <Input value={project.link || ""} onChange={(e) => update("link", e.target.value || null)} placeholder="https://..." className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">GitHub</Label>
          <Input value={project.github || ""} onChange={(e) => update("github", e.target.value || null)} placeholder="owner/repo" className="h-8 text-sm" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Tech Stack (comma-separated)</Label>
        <Input
          value={project.techstacks.join(", ")}
          onChange={(e) => update("techstacks", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
          placeholder="React, TypeScript, Node.js"
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}

function ExperienceEditor({
  experience,
  index,
  onChange,
  onRemove,
  label,
}: {
  experience: SiteConfigExperience;
  index: number;
  onChange: (e: SiteConfigExperience) => void;
  onRemove: () => void;
  label?: string;
}) {
  const update = (field: keyof SiteConfigExperience, value: unknown) =>
    onChange({ ...experience, [field]: value });

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-muted-foreground">#{index + 1}</span>
          <span>{label || "Experience"}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Role / Title</Label>
          <Input value={experience.role} onChange={(e) => update("role", e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Company / Organization</Label>
          <Input value={experience.company} onChange={(e) => update("company", e.target.value)} className="h-8 text-sm" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Period</Label>
          <Input value={experience.year} onChange={(e) => update("year", e.target.value)} placeholder="Jan 2023 - Present" className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={experience.type} onValueChange={(v) => update("type", v)}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Full-Time">Full-Time</SelectItem>
              <SelectItem value="Part-Time">Part-Time</SelectItem>
              <SelectItem value="Internship">Internship</SelectItem>
              <SelectItem value="Contract">Contract</SelectItem>
              <SelectItem value="Freelance">Freelance</SelectItem>
              <SelectItem value="Certification">Certification</SelectItem>
              <SelectItem value="Course">Course</SelectItem>
              <SelectItem value="Volunteer">Volunteer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Location</Label>
          <Input value={experience.location} onChange={(e) => update("location", e.target.value)} placeholder="Remote, SF" className="h-8 text-sm" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Tech Stack (comma-separated)</Label>
        <Input
          value={experience.techstacks?.join(", ") || ""}
          onChange={(e) => update("techstacks", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
          placeholder="React, TypeScript, Node.js"
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Key Responsibilities (one per line, use **bold** for highlights)</Label>
        <Textarea
          value={parseSegmentsToMarkdown(experience.responsibility || [])}
          onChange={(e) => {
            const lines = e.target.value.split("\n");
            const responsibility = lines
              .map((line) => parseMarkdownToSegments(line))
              .filter((bullet) => bullet.length > 0);
            update("responsibility", responsibility);
          }}
          placeholder="Built **AI Blox**, a visual tool&#10;Led a team of **4 developers**"
          className="min-h-24 text-sm"
        />
      </div>
    </div>
  );
}

function HackathonEditor({
  hackathon,
  index,
  onChange,
  onRemove,
}: {
  hackathon: SiteConfigHackathon;
  index: number;
  onChange: (h: SiteConfigHackathon) => void;
  onRemove: () => void;
}) {
  const update = (field: keyof SiteConfigHackathon, value: unknown) =>
    onChange({ ...hackathon, [field]: value });

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-muted-foreground">#{index + 1}</span>
          <span>Hackathon Project</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Project/Product Title</Label>
          <Input value={hackathon.title} onChange={(e) => update("title", e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Event Name</Label>
          <Input value={hackathon.event} onChange={(e) => update("event", e.target.value)} placeholder="vibeFORWARD Hackathon" className="h-8 text-sm" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-xs">Year / Period</Label>
          <Input value={hackathon.year} onChange={(e) => update("year", e.target.value)} placeholder="Apr 2026" className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Placement</Label>
          <Input value={hackathon.placement || ""} onChange={(e) => update("placement", e.target.value || null)} placeholder="1st Place, Finalist" className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Hosting College / Venue</Label>
          <Input value={hackathon.college || ""} onChange={(e) => update("college", e.target.value || null)} placeholder="NYU, Fordham" className="h-8 text-sm" />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Description (use **bold** for highlights)</Label>
        <Textarea
          value={parse1DSegmentsToMarkdown(hackathon.body || [])}
          onChange={(e) => update("body", parseMarkdownTo1DSegments(e.target.value))}
          placeholder="Built **AI Blox**, a visual tool with **500+ building blocks**."
          className="min-h-16 text-sm"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Tech Stack (comma-separated)</Label>
          <Input
            value={hackathon.techstacks?.join(", ") || ""}
            onChange={(e) => update("techstacks", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
            placeholder="Next.js, TypeScript, Python"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Devpost / Project Link</Label>
          <Input value={hackathon.link || ""} onChange={(e) => update("link", e.target.value || null)} placeholder="https://devpost.com/..." className="h-8 text-sm" />
        </div>
      </div>
    </div>
  );
}

function ResearchEditor({
  research,
  index,
  onChange,
  onRemove,
}: {
  research: SiteConfigResearch;
  index: number;
  onChange: (r: SiteConfigResearch) => void;
  onRemove: () => void;
}) {
  const update = (field: keyof SiteConfigResearch, value: unknown) =>
    onChange({ ...research, [field]: value });

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-semibold text-muted-foreground">#{index + 1}</span>
          <span>Research Publication / Project</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onRemove} className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Title</Label>
          <Input value={research.title} onChange={(e) => update("title", e.target.value)} className="h-8 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Year</Label>
          <Input value={research.year} onChange={(e) => update("year", e.target.value)} placeholder="e.g., 2025" className="h-8 text-sm" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Authors (comma-separated)</Label>
          <Input
            value={research.authors?.join(", ") || ""}
            onChange={(e) => update("authors", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
            placeholder="John Doe, Jane Smith"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Venue / Journal / Conference</Label>
          <Input value={research.venue || ""} onChange={(e) => update("venue", e.target.value)} placeholder="IEEE, NeurIPS" className="h-8 text-sm" />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Publication / Paper Link</Label>
        <Input value={research.link || ""} onChange={(e) => update("link", e.target.value)} placeholder="https://arxiv.org/..." className="h-8 text-sm" />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Abstract / Description</Label>
        <Textarea
          value={research.description || ""}
          onChange={(e) => update("description", e.target.value)}
          placeholder="Brief description of the research paper or findings..."
          className="min-h-20 text-sm"
        />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PortfolioSettingsPage() {
  const [portfolio, setPortfolio] = useState<PortfolioRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [profileStatus, setProfileStatus] = useState<ProfileStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generateSuccess, setGenerateSuccess] = useState(false);

  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [unpublishing, setUnpublishing] = useState(false);

  const [copied, setCopied] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Editable config state
  const [editConfig, setEditConfig] = useState<SiteConfig | null>(null);

  // Avatar upload
  const avatarRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  // Custom sections (e.g. Certifications)
  const [customSections, setCustomSections] = useState<
    { name: string; items: SiteConfigExperience[] }[]
  >([]);

  const [loadError, setLoadError] = useState<string | null>(null);

  // Reusable helper to process SiteConfig, generating editor keys and extracting custom sections
  const processSiteConfig = useCallback((cfg: SiteConfig) => {
    const rawCfg = cfg as SiteConfig & Record<string, unknown>;

    // Generate stable _editorId unique keys for items (Issue #16 - React key anti-pattern)
    const projects = (rawCfg.projects ?? []).map((p) => ({
      ...p,
      _editorId: (p as any)._editorId || Math.random().toString(36).substring(7),
    }));

    // Extract custom sections from custom_* keys
    const customKeys = Object.keys(rawCfg).filter(
      (k) => k.startsWith("custom_") && Array.isArray(rawCfg[k]),
    );
    const sections = customKeys.map((k) => ({
      name: k.replace("custom_", "").replace(/_/g, " "),
      items: ((rawCfg[k] as SiteConfigExperience[]) || []).map((item) => ({
        ...item,
        _editorId: (item as any)._editorId || Math.random().toString(36).substring(7),
      })),
    }));
    setCustomSections(sections);

    // Filter out merged custom items from experiences for editing
    const experiences = (rawCfg.experiences ?? [])
      .filter((exp: any) => !exp._customSection)
      .map((item) => ({
        ...item,
        _editorId: (item as any)._editorId || Math.random().toString(36).substring(7),
      }));

    // Hackathons & Research stable _editorId keys
    const hackathons = (rawCfg.hackathons ?? []).map((h: any) => ({
      ...h,
      _editorId: h._editorId || Math.random().toString(36).substring(7),
    }));

    const research = (rawCfg.research ?? []).map((r: any) => ({
      ...r,
      _editorId: r._editorId || Math.random().toString(36).substring(7),
    }));

    setEditConfig({
      ...rawCfg,
      projects,
      experiences,
      hackathons,
      research,
    } as SiteConfig);
  }, []);

  // ── Load portfolio ──────────────────────────────────────────────────────────

  const loadPortfolio = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/portfolio/me");
      if (!res.ok) {
        throw new Error(`Failed to fetch portfolio settings: ${res.statusText}`);
      }
      const json = await res.json();
      if (json.portfolio) {
        setPortfolio(json.portfolio);
        if (json.portfolio.username) setUsername(json.portfolio.username);
        if (json.portfolio.site_config) {
          processSiteConfig(json.portfolio.site_config as SiteConfig);
        }
      }
    } catch (err: any) {
      console.error(err);
      setLoadError("Failed to load portfolio settings. Please refresh or try again.");
    }
    setLoading(false);
  }, [processSiteConfig]);

  // ── Load profile / connector status ─────────────────────────────────────────

  const loadProfileStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/profile/status");
      const json = await res.json();
      setProfileStatus({
        hasResume: json.hasResume ?? false,
        hasGitHub: json.hasGitHub ?? false,
        githubConnected: json.githubConnected ?? false,
        githubUsername: json.githubUsername ?? null,
      });
    } catch {}
    setStatusLoading(false);
  }, []);

  useEffect(() => {
    loadPortfolio();
    loadProfileStatus();
  }, [loadPortfolio, loadProfileStatus]);

  // ── Username availability check ─────────────────────────────────────────────

  useEffect(() => {
    if (!username || username.length < 3) {
      setUsernameStatus("idle");
      return;
    }
    const valid = /^[a-z0-9][a-z0-9_-]{2,31}$/.test(username);
    if (!valid) {
      setUsernameStatus("invalid");
      return;
    }
    setUsernameStatus("checking");
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/portfolio/check/${username}`);
        const json = await res.json();
        setUsernameStatus(json.available ? "available" : "taken");
      } catch {
        setUsernameStatus("idle");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [username]);

  // ── Generate ────────────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    setGenerateSuccess(false);
    try {
      const res = await fetch("/api/portfolio/generate", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to generate portfolio");
      setGenerateSuccess(true);

      const meRes = await fetch("/api/portfolio/me");
      const meJson = await meRes.json();
      if (meJson.portfolio) {
        setPortfolio(meJson.portfolio);
        if (meJson.portfolio.username) setUsername(meJson.portfolio.username);
        if (meJson.portfolio.site_config) {
          processSiteConfig(meJson.portfolio.site_config as SiteConfig);
        }
      } else if (json.config) {
        const cfg = json.config as SiteConfig;
        processSiteConfig(cfg);
        setPortfolio({
          id: `temp-${Math.random().toString(36).substring(7)}`,
          username: null,
          site_config: cfg,
          display_name: cfg.identity?.name ?? null,
          bio: cfg.identity?.bio ?? null,
          avatar_url: null,
          tech_stack: [
            ...new Set([
              ...(cfg.projects?.flatMap((p) => p.techstacks) ?? []),
              ...(cfg.experiences?.flatMap((e: SiteConfigExperience) => e.techstacks ?? []) ?? []),
            ]),
          ].slice(0, 20),
          years_experience: null,
          config_generated_at: new Date().toISOString(),
          is_published: false,
          published_at: null,
        });
      }
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Unknown error");
    }
    setGenerating(false);
  };

  // ── Save config changes ─────────────────────────────────────────────────────

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!editConfig) return;
    setSaving(true);
    setSaveSuccess(false);
    setSaveError(null);
    try {
      // Build config to save — start fresh from editConfig
      const configToSave: Record<string, unknown> = { ...editConfig };

      // Remove any stale custom_* keys from previous saves
      for (const key of Object.keys(configToSave)) {
        if (key.startsWith("custom_")) delete configToSave[key];
      }

      // Save custom sections as custom_* keys for round-trip editing
      for (const section of customSections) {
        const key = `custom_${section.name.toLowerCase().replace(/\s+/g, "_")}`;
        // Strip _editorId keys from custom section items
        configToSave[key] = section.items.map((item) => {
          const { _editorId, ...rest } = item as any;
          return rest;
        });
      }

      // Merge custom section items into experiences so they render on the portfolio
      const baseExperiences = editConfig.experiences || [];
      const customItems = customSections.flatMap((section) =>
        section.items.map((item) => {
          const { _editorId, ...rest } = item as any;
          return {
            ...rest,
            type: item.type || section.name,
            _customSection: section.name,
          };
        }),
      );

      // Remove previously merged custom items (identified by _customSection) and add fresh ones
      const cleanExperiences = baseExperiences
        .filter((exp: any) => !exp._customSection)
        .map((exp) => {
          const { _editorId, ...rest } = exp as any;
          return rest;
        });

      configToSave.experiences = [...cleanExperiences, ...customItems];

      // Strip _editorId from projects, hackathons, and research (Issue #16)
      if (Array.isArray(configToSave.projects)) {
        configToSave.projects = configToSave.projects.map((p: any) => {
          const { _editorId, ...rest } = p;
          return rest;
        });
      }
      if (Array.isArray(configToSave.hackathons)) {
        configToSave.hackathons = configToSave.hackathons.map((h: any) => {
          const { _editorId, ...rest } = h;
          return rest;
        });
      }
      if (Array.isArray(configToSave.research)) {
        configToSave.research = configToSave.research.map((r: any) => {
          const { _editorId, ...rest } = r;
          return rest;
        });
      }

      // Dynamically calculate tech_stack from projects and experiences (Issue #2)
      const techStackSet = new Set<string>();
      if (Array.isArray(configToSave.projects)) {
        for (const p of configToSave.projects) {
          if (Array.isArray(p.techstacks)) {
            for (const t of p.techstacks) {
              if (t) techStackSet.add(t);
            }
          }
        }
      }
      if (Array.isArray(configToSave.experiences)) {
        for (const e of configToSave.experiences) {
          if (Array.isArray(e.techstacks)) {
            for (const t of e.techstacks) {
              if (t) techStackSet.add(t);
            }
          }
        }
      }
      const tech_stack = Array.from(techStackSet).slice(0, 20);

      const res = await fetch("/api/portfolio/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site_config: configToSave,
          display_name: editConfig.identity.name,
          bio: editConfig.identity.bio,
          tech_stack,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to save");
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      // Invalidate ISR cache for the public portfolio page so changes appear immediately
      if (portfolio?.username) {
        try {
          await fetch("/api/revalidate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: `/portfolio/${portfolio.username}` }),
          });
        } catch {
          // Non-critical — revalidation is a best-effort optimization
        }
      }
      // Reload to get the merged result
      await loadPortfolio();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save changes");
    }
    setSaving(false);
  };

  // ── Avatar upload ───────────────────────────────────────────────────────────

  const [avatarError, setAvatarError] = useState<string | null>(null);

  const handleAvatarUpload = async (file: File) => {
    setAvatarUploading(true);
    setAvatarError(null);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/portfolio/avatar", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      if (json.avatarUrl) {
        setPortfolio((prev) => prev ? { ...prev, avatar_url: json.avatarUrl } : prev);
        setEditConfig((prev) => prev ? { ...prev, avatarUrl: json.avatarUrl } as SiteConfig : prev);
      }
    } catch (e) {
      setAvatarError(e instanceof Error ? e.message : "Failed to upload avatar");
    }
    setAvatarUploading(false);
  };

  // ── Publish ─────────────────────────────────────────────────────────────────

  const handlePublish = async () => {
    if (!username) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const res = await fetch("/api/portfolio/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to publish");
      await loadPortfolio();
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Unknown error");
    }
    setPublishing(false);
  };

  // ── Unpublish ───────────────────────────────────────────────────────────────

  const handleUnpublish = async () => {
    setUnpublishing(true);
    setPublishError(null);
    try {
      const res = await fetch("/api/portfolio/publish", { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Failed to unpublish portfolio");
      }
      await loadPortfolio();
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : "Failed to unpublish portfolio");
    }
    setUnpublishing(false);
  };

  // ── Copy link ───────────────────────────────────────────────────────────────

  const handleCopy = () => {
    if (!portfolio?.username) return;
    const url = `${window.location.origin}/portfolio/${portfolio.username}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Config update helpers ───────────────────────────────────────────────────

  const updateConfig = (partial: Partial<SiteConfig>) => {
    setEditConfig((prev) => (prev ? { ...prev, ...partial } : prev));
  };

  const updateProject = (index: number, project: SiteConfigProject) => {
    setEditConfig((prev) => {
      if (!prev) return prev;
      const projects = [...prev.projects];
      projects[index] = project;
      return { ...prev, projects };
    });
  };

  const removeProject = (index: number) => {
    if (window.confirm("Are you sure you want to delete this project?")) {
      setEditConfig((prev) => {
        if (!prev) return prev;
        return { ...prev, projects: prev.projects.filter((_, i) => i !== index) };
      });
    }
  };

  const addProject = () => {
    setEditConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        projects: [
          ...prev.projects,
          { title: "", category: "", description: "", techstacks: [], status: "active", link: null, github: null },
        ],
      };
    });
  };

  const updateExperience = (index: number, exp: SiteConfigExperience) => {
    setEditConfig((prev) => {
      if (!prev) return prev;
      const experiences = [...prev.experiences];
      experiences[index] = exp;
      return { ...prev, experiences };
    });
  };

  const removeExperience = (index: number) => {
    if (window.confirm("Are you sure you want to delete this experience?")) {
      setEditConfig((prev) => {
        if (!prev) return prev;
        return { ...prev, experiences: prev.experiences.filter((_, i) => i !== index) };
      });
    }
  };

  const addExperience = () => {
    setEditConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        experiences: [
          ...prev.experiences,
          { role: "", year: "", company: "", type: "Full-Time", location: "" },
        ],
      };
    });
  };

  // ── Hackathons & Research State Helpers ─────────────────────────────────────

  const updateHackathon = (index: number, hackathon: SiteConfigHackathon) => {
    setEditConfig((prev) => {
      if (!prev) return prev;
      const hackathons = [...prev.hackathons];
      hackathons[index] = hackathon;
      return { ...prev, hackathons };
    });
  };

  const removeHackathon = (index: number) => {
    if (window.confirm("Are you sure you want to delete this hackathon project?")) {
      setEditConfig((prev) => {
        if (!prev) return prev;
        return { ...prev, hackathons: prev.hackathons.filter((_, i) => i !== index) };
      });
    }
  };

  const addHackathon = () => {
    setEditConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        hackathons: [
          ...prev.hackathons,
          { title: "", event: "", year: "", placement: null, college: null, body: [], techstacks: [], link: null },
        ],
      };
    });
  };

  const updateResearch = (index: number, res: SiteConfigResearch) => {
    setEditConfig((prev) => {
      if (!prev) return prev;
      const research = [...prev.research];
      research[index] = res;
      return { ...prev, research };
    });
  };

  const removeResearch = (index: number) => {
    if (window.confirm("Are you sure you want to delete this research item?")) {
      setEditConfig((prev) => {
        if (!prev) return prev;
        return { ...prev, research: prev.research.filter((_, i) => i !== index) };
      });
    }
  };

  const addResearch = () => {
    setEditConfig((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        research: [
          ...prev.research,
          { title: "", year: "", authors: [], venue: "", link: "", description: "" },
        ],
      };
    });
  };

  // ── Custom section helpers ──────────────────────────────────────────────────

  const addCustomSection = () => {
    setCustomSections((prev) => [
      ...prev,
      { name: "Certifications", items: [] },
    ]);
  };

  const updateCustomSectionName = (index: number, name: string) => {
    setCustomSections((prev) => {
      const sections = [...prev];
      sections[index] = { ...sections[index], name };
      return sections;
    });
  };

  const addCustomSectionItem = (sectionIndex: number) => {
    setCustomSections((prev) => {
      const sections = [...prev];
      sections[sectionIndex] = {
        ...sections[sectionIndex],
        items: [
          ...sections[sectionIndex].items,
          { role: "", year: "", company: "", type: "Certification", location: "" },
        ],
      };
      return sections;
    });
  };

  const updateCustomSectionItem = (sectionIndex: number, itemIndex: number, item: SiteConfigExperience) => {
    setCustomSections((prev) => {
      const sections = [...prev];
      const items = [...sections[sectionIndex].items];
      items[itemIndex] = item;
      sections[sectionIndex] = { ...sections[sectionIndex], items };
      return sections;
    });
  };

  const removeCustomSectionItem = (sectionIndex: number, itemIndex: number) => {
    if (window.confirm("Are you sure you want to delete this item?")) {
      setCustomSections((prev) => {
        const sections = [...prev];
        sections[sectionIndex] = {
          ...sections[sectionIndex],
          items: sections[sectionIndex].items.filter((_, i) => i !== itemIndex),
        };
        return sections;
      });
    }
  };

  const removeCustomSection = (index: number) => {
    if (window.confirm("Are you sure you want to delete this custom section and all its items?")) {
      setCustomSections((prev) => prev.filter((_, i) => i !== index));
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading || statusLoading) {
    return (
      <div className="min-h-full bg-background">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  const hasConfig = !!portfolio?.config_generated_at;
  const portfolioUrl = portfolio?.username
    ? `/portfolio/${portfolio.username}`
    : null;
  const resumeReady = profileStatus?.hasResume ?? false;
  const githubReady = profileStatus?.githubConnected ?? false;

  return (
    <div className="min-h-full bg-background">
      <div className="mx-auto max-w-4xl space-y-8 p-4 pb-20 sm:p-6 lg:p-8">
      {/* ── Page Header ── */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Build, customize, and publish your public portfolio.
          </p>
        </div>
        {hasConfig && editConfig && (
          <div className="flex items-center gap-2 mt-3 sm:mt-0">
            {portfolioUrl && (
              <Button size="sm" variant="outline" asChild className="gap-1.5">
                <Link href={portfolioUrl} target="_blank">
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </Link>
              </Button>
            )}
            <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saveSuccess ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {saveSuccess ? "Saved" : "Save Changes"}
            </Button>
          </div>
        )}
      </div>

      {/* ── Error Messages ── */}
      {(saveError || avatarError || loadError) && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="space-y-1">
            {loadError && <p>{loadError}</p>}
            {saveError && <p>{saveError}</p>}
            {avatarError && <p>{avatarError}</p>}
          </div>
        </div>
      )}

      {/* ── Status Overview (stat cards row) ── */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs text-muted-foreground">Status</span>
          </div>
          <p className="text-lg font-semibold">
            {portfolio?.is_published ? "Live" : hasConfig ? "Draft" : "Setup"}
          </p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-xs text-muted-foreground">Projects</span>
          </div>
          <p className="text-lg font-semibold">{editConfig?.projects?.length ?? 0}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2 w-2 rounded-full bg-purple-500" />
            <span className="text-xs text-muted-foreground">Experiences</span>
          </div>
          <p className="text-lg font-semibold">{editConfig?.experiences?.length ?? 0}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span className="text-xs text-muted-foreground">Custom</span>
          </div>
          <p className="text-lg font-semibold">{customSections.reduce((n, s) => n + s.items.length, 0)}</p>
        </div>
      </div>

      {/* ── Published Banner ── */}
      {portfolio?.is_published && portfolioUrl && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-green-500/20 bg-green-500/5 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500/10">
              <Globe className="h-4 w-4 text-green-500" />
            </div>
            <div>
              <p className="text-sm font-medium">Portfolio is live</p>
              <p className="text-xs text-muted-foreground">
                {typeof window !== "undefined" ? window.location.origin : ""}{portfolioUrl}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleCopy} className="gap-1.5 h-8">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="outline" asChild className="gap-1.5 h-8">
              <Link href={portfolioUrl} target="_blank">
                <ExternalLink className="h-3 w-3" />
                Open
              </Link>
            </Button>
            <Button size="sm" variant="destructive" onClick={handleUnpublish} disabled={unpublishing} className="gap-1.5 h-8">
              {unpublishing ? <Loader2 className="h-3 w-3 animate-spin" /> : <EyeOff className="h-3 w-3" />}
              Unpublish
            </Button>
          </div>
        </div>
      )}

      {/* ── Data Sources + Generate — side by side on wider screens ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Data Sources */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Data Sources</CardTitle>
            <CardDescription className="text-xs">
              Connect data for portfolio generation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Resume</span>
                {resumeReady ? (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-green-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Connected
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-destructive">
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                    Missing
                  </span>
                )}
              </div>
              <Button size="sm" variant="outline" asChild className="h-7 text-xs">
                <Link href="/connectors">{resumeReady ? "Re-upload" : "Upload"}</Link>
              </Button>
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <Github className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">GitHub</span>
                {githubReady ? (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-green-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    {profileStatus?.githubUsername ?? "Connected"}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground">Optional</span>
                )}
              </div>
              {!githubReady && (
                <Button size="sm" variant="outline" asChild className="h-7 text-xs">
                  <Link href="/connectors">Connect</Link>
                </Button>
              )}
            </div>

            {!resumeReady && (
              <p className="flex items-center gap-1.5 text-xs text-amber-500 pt-1">
                <AlertCircle className="h-3 w-3" />
                Resume is required before generating.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Generate */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-3.5 w-3.5" />
                {hasConfig ? "Regenerate" : "Generate Portfolio"}
              </CardTitle>
              {hasConfig && (
                <Badge variant="outline" className={portfolio?.is_published ? "border-green-500/30 text-green-500 text-[10px]" : "text-[10px]"}>
                  {portfolio?.is_published ? "Published" : "Draft"}
                </Badge>
              )}
            </div>
            <CardDescription className="text-xs">
              AI reads your resume{githubReady ? " + GitHub" : ""} to build content.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {generateError && (
              <p className="text-xs text-destructive">{generateError}</p>
            )}
            {generateSuccess && (
              <p className="flex items-center gap-1.5 text-xs text-green-500">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Generated! Customize below, then publish.
              </p>
            )}
            <Button
              onClick={handleGenerate}
              disabled={generating || !resumeReady}
              className="w-full"
              size="sm"
            >
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-3.5 w-3.5" />
                  {hasConfig ? "Regenerate" : "Generate Portfolio"}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* ── Editable Config (only shown after generation) ── */}
      {hasConfig && editConfig && (
        <>
          {/* Profile Card */}
          <div className="rounded-lg border bg-card overflow-hidden">
            <div className="h-24 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent" />
            <div className="px-5 pb-5 -mt-12">
              <div className="flex items-end gap-4">
                {/* Avatar */}
                <div className="relative group shrink-0">
                  <div className="h-20 w-20 rounded-xl border-4 border-card overflow-hidden bg-muted flex items-center justify-center shadow-sm">
                    {portfolio?.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={portfolio.avatar_url}
                        alt={editConfig.identity.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <User className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                  <input
                    ref={avatarRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleAvatarUpload(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => avatarRef.current?.click()}
                    disabled={avatarUploading}
                    className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    {avatarUploading ? (
                      <Loader2 className="h-4 w-4 animate-spin text-white" />
                    ) : (
                      <ImageIcon className="h-4 w-4 text-white" />
                    )}
                  </button>
                </div>

                <div className="flex-1 min-w-0 pb-1">
                  <h3 className="font-semibold text-lg truncate">{editConfig.identity.name}</h3>
                  <p className="text-sm text-muted-foreground truncate">{editConfig.identity.title}</p>
                </div>
              </div>

              {editConfig.identity.tagline && (
                <p className="text-xs text-muted-foreground mt-3 italic">{editConfig.identity.tagline}</p>
              )}

              {portfolio?.tech_stack && portfolio.tech_stack.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {portfolio.tech_stack.slice(0, 10).map((t) => (
                    <span key={t} className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {t}
                    </span>
                  ))}
                  {portfolio.tech_stack.length > 10 && (
                    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                      +{portfolio.tech_stack.length - 10}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Tabbed Editor ── */}
          <Tabs defaultValue="identity" className="w-full">
            <div className="rounded-lg border bg-card p-1 -mx-2 sm:mx-0 overflow-x-auto">
              <TabsList className="flex w-max min-w-full sm:grid sm:grid-cols-7 bg-transparent h-9 gap-0">
                <TabsTrigger value="identity" className="flex-1 min-w-[88px] sm:min-w-0 text-xs gap-1.5 data-[state=active]:bg-muted rounded-md">
                  <User className="h-3 w-3 hidden sm:block" /> Identity
                </TabsTrigger>
                <TabsTrigger value="projects" className="flex-1 min-w-[88px] sm:min-w-0 text-xs gap-1.5 data-[state=active]:bg-muted rounded-md">
                  <Code2 className="h-3 w-3 hidden sm:block" /> Projects
                </TabsTrigger>
                <TabsTrigger value="experience" className="flex-1 min-w-[88px] sm:min-w-0 text-xs gap-1.5 data-[state=active]:bg-muted rounded-md">
                  <Briefcase className="h-3 w-3 hidden sm:block" /> Experience
                </TabsTrigger>
                <TabsTrigger value="hackathons" className="flex-1 min-w-[88px] sm:min-w-0 text-xs gap-1.5 data-[state=active]:bg-muted rounded-md">
                  <Award className="h-3 w-3 hidden sm:block" /> Hacks
                </TabsTrigger>
                <TabsTrigger value="research" className="flex-1 min-w-[88px] sm:min-w-0 text-xs gap-1.5 data-[state=active]:bg-muted rounded-md">
                  <FileText className="h-3 w-3 hidden sm:block" /> Research
                </TabsTrigger>
                <TabsTrigger value="socials" className="flex-1 min-w-[88px] sm:min-w-0 text-xs gap-1.5 data-[state=active]:bg-muted rounded-md">
                  <Globe className="h-3 w-3 hidden sm:block" /> Socials
                </TabsTrigger>
                <TabsTrigger value="custom" className="flex-1 min-w-[88px] sm:min-w-0 text-xs gap-1.5 data-[state=active]:bg-muted rounded-md">
                  <Sparkles className="h-3 w-3 hidden sm:block" /> Custom
                </TabsTrigger>
              </TabsList>
            </div>

            {/* ── Identity Tab ── */}
            <TabsContent value="identity" className="mt-4 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Personal Info</CardTitle>
                </CardHeader>
                <CardContent>
                  <IdentityEditor
                    identity={editConfig.identity}
                    onChange={(identity) => updateConfig({ identity })}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Contact</CardTitle>
                </CardHeader>
                <CardContent>
                  <ContactEditor
                    contact={editConfig.contact}
                    onChange={(contact) => updateConfig({ contact })}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Projects Tab ── */}
            <TabsContent value="projects" className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {editConfig.projects.length} project{editConfig.projects.length !== 1 ? "s" : ""}
                </p>
                <Button size="sm" variant="outline" onClick={addProject} className="gap-1.5 text-xs h-8">
                  <Plus className="h-3 w-3" /> Add Project
                </Button>
              </div>
              {editConfig.projects.map((project, i) => (
                <ProjectEditor
                  key={project._editorId || i}
                  project={project}
                  index={i}
                  onChange={(p) => updateProject(i, p)}
                  onRemove={() => removeProject(i)}
                />
              ))}
              {editConfig.projects.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-muted-foreground">
                  <Code2 className="h-8 w-8 mb-3 opacity-30" />
                  <p className="text-sm">No projects yet</p>
                  <p className="text-xs mt-1 text-muted-foreground/60">Add projects to showcase your work</p>
                  <Button size="sm" variant="outline" onClick={addProject} className="mt-3 gap-1.5 text-xs h-8">
                    <Plus className="h-3 w-3" /> Add your first project
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* ── Experience Tab ── */}
            <TabsContent value="experience" className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {editConfig.experiences.length} experience{editConfig.experiences.length !== 1 ? "s" : ""}
                </p>
                <Button size="sm" variant="outline" onClick={addExperience} className="gap-1.5 text-xs h-8">
                  <Plus className="h-3 w-3" /> Add Experience
                </Button>
              </div>
              {editConfig.experiences.map((exp, i) => (
                <ExperienceEditor
                  key={exp._editorId || i}
                  experience={exp}
                  index={i}
                  onChange={(e) => updateExperience(i, e)}
                  onRemove={() => removeExperience(i)}
                />
              ))}
              {editConfig.experiences.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-muted-foreground">
                  <Briefcase className="h-8 w-8 mb-3 opacity-30" />
                  <p className="text-sm">No experiences yet</p>
                  <p className="text-xs mt-1 text-muted-foreground/60">Add your work history and education</p>
                  <Button size="sm" variant="outline" onClick={addExperience} className="mt-3 gap-1.5 text-xs h-8">
                    <Plus className="h-3 w-3" /> Add your first experience
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* ── Hackathons Tab ── */}
            <TabsContent value="hackathons" className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {editConfig.hackathons.length} hackathon project{editConfig.hackathons.length !== 1 ? "s" : ""}
                </p>
                <Button size="sm" variant="outline" onClick={addHackathon} className="gap-1.5 text-xs h-8">
                  <Plus className="h-3 w-3" /> Add Hackathon Project
                </Button>
              </div>
              {editConfig.hackathons.map((hackathon, i) => (
                <HackathonEditor
                  key={hackathon._editorId || i}
                  hackathon={hackathon}
                  index={i}
                  onChange={(h) => updateHackathon(i, h)}
                  onRemove={() => removeHackathon(i)}
                />
              ))}
              {editConfig.hackathons.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-muted-foreground">
                  <Award className="h-8 w-8 mb-3 opacity-30" />
                  <p className="text-sm">No hackathons yet</p>
                  <p className="text-xs mt-1 text-muted-foreground/60">Add hackathon projects to showcase your quick builds</p>
                  <Button size="sm" variant="outline" onClick={addHackathon} className="mt-3 gap-1.5 text-xs h-8">
                    <Plus className="h-3 w-3" /> Add your first hackathon project
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* ── Research Tab ── */}
            <TabsContent value="research" className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {editConfig.research.length} research publication{editConfig.research.length !== 1 ? "s" : ""}
                </p>
                <Button size="sm" variant="outline" onClick={addResearch} className="gap-1.5 text-xs h-8">
                  <Plus className="h-3 w-3" /> Add Research Item
                </Button>
              </div>
              {editConfig.research.map((res, i) => (
                <ResearchEditor
                  key={res._editorId || i}
                  research={res}
                  index={i}
                  onChange={(r) => updateResearch(i, r)}
                  onRemove={() => removeResearch(i)}
                />
              ))}
              {editConfig.research.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-muted-foreground">
                  <FileText className="h-8 w-8 mb-3 opacity-30" />
                  <p className="text-sm">No research items yet</p>
                  <p className="text-xs mt-1 text-muted-foreground/60">Add your papers, journals, or research publications</p>
                  <Button size="sm" variant="outline" onClick={addResearch} className="mt-3 gap-1.5 text-xs h-8">
                    <Plus className="h-3 w-3" /> Add your first research item
                  </Button>
                </div>
              )}
            </TabsContent>

            {/* ── Socials Tab ── */}
            <TabsContent value="socials" className="mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Social Links</CardTitle>
                  <CardDescription className="text-xs">
                    Enter your username for each platform. URLs are auto-generated.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <SocialsEditor
                    socials={editConfig.socials}
                    onChange={(socials) => updateConfig({ socials })}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Custom Sections Tab ── */}
            <TabsContent value="custom" className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Custom Sections</p>
                  <p className="text-xs text-muted-foreground">
                    Certifications, Volunteer Work, Awards, etc.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={addCustomSection} className="gap-1.5 text-xs h-8">
                  <Plus className="h-3 w-3" /> Add Section
                </Button>
              </div>

              {customSections.map((section, si) => (
                <Card key={si}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Award className="h-4 w-4 text-muted-foreground" />
                        <Input
                          value={section.name}
                          onChange={(e) => updateCustomSectionName(si, e.target.value)}
                          className="h-7 w-40 text-sm font-medium"
                          placeholder="Section name"
                        />
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => addCustomSectionItem(si)}
                          className="h-7 text-xs gap-1"
                        >
                          <Plus className="h-3 w-3" /> Add Item
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeCustomSection(si)}
                          className="h-7 text-xs text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {section.items.map((item, ii) => (
                      <ExperienceEditor
                        key={item._editorId || ii}
                        experience={item}
                        index={ii}
                        onChange={(e) => updateCustomSectionItem(si, ii, e)}
                        onRemove={() => removeCustomSectionItem(si, ii)}
                        label={section.name}
                      />
                    ))}
                    {section.items.length === 0 && (
                      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-6 text-muted-foreground">
                        <p className="text-xs">No items in this section</p>
                        <Button size="sm" variant="ghost" onClick={() => addCustomSectionItem(si)} className="mt-1.5 gap-1 text-xs">
                          <Plus className="h-3 w-3" /> Add item
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}

              {customSections.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-10 text-muted-foreground">
                  <Award className="h-8 w-8 mb-3 opacity-30" />
                  <p className="text-sm">No custom sections</p>
                  <p className="text-xs mt-1 text-muted-foreground/60">Add sections like Certifications, Awards, etc.</p>
                  <Button size="sm" variant="outline" onClick={addCustomSection} className="mt-3 gap-1.5 text-xs h-8">
                    <Plus className="h-3 w-3" /> Add your first section
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* ── Sticky Save Bar ── */}
      {hasConfig && editConfig && (
        <div className="sticky bottom-4 z-10">
          <div className="flex items-center justify-between rounded-lg border bg-card/95 backdrop-blur-sm p-3 shadow-lg">
            <p className="text-xs text-muted-foreground">
              Last generated:{" "}
              {portfolio?.config_generated_at
                ? new Date(portfolio.config_generated_at).toLocaleDateString()
                : "---"}
            </p>
            <Button onClick={handleSave} disabled={saving} size="sm" className="gap-1.5">
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saveSuccess ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {saveSuccess ? "Saved!" : "Save All Changes"}
            </Button>
          </div>
        </div>
      )}

      {/* ── Publish Section ── */}
      {hasConfig && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Globe className="h-4 w-4" />
              Publish
            </CardTitle>
            <CardDescription className="text-xs">
              Choose a username for your public portfolio URL.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <span className="text-xs text-muted-foreground shrink-0 font-mono">
                  yoursite.com/portfolio/
                </span>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  placeholder="your-name"
                  className="w-full sm:max-w-[200px] h-8 text-sm"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {usernameStatus === "checking" && "Checking availability..."}
                {usernameStatus === "available" && (
                  <span className="text-green-500">Username is available</span>
                )}
                {usernameStatus === "taken" && (
                  <span className="text-destructive">Username is already taken</span>
                )}
                {usernameStatus === "invalid" && (
                  <span className="text-destructive">
                    3-32 chars, lowercase letters, numbers, hyphens, underscores
                  </span>
                )}
                {usernameStatus === "idle" && "Lowercase letters, numbers, hyphens, underscores (3-32 chars)"}
              </p>
            </div>

            {publishError && (
              <p className="text-xs text-destructive">{publishError}</p>
            )}

            <Button
              onClick={handlePublish}
              disabled={publishing || usernameStatus === "checking" || usernameStatus === "taken" || usernameStatus === "invalid" || !username}
              className="w-full"
              size="sm"
            >
              {publishing ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Publishing...
                </>
              ) : (
                <>
                  <Eye className="mr-2 h-3.5 w-3.5" />
                  {portfolio?.is_published ? "Update & Publish" : "Publish Portfolio"}
                </>
              )}
            </Button>

            {portfolioUrl && (
              <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2">
                <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Link
                  href={portfolioUrl}
                  target="_blank"
                  className="text-xs text-primary hover:underline truncate font-mono"
                >
                  /portfolio/{portfolio?.username}
                </Link>
                <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
              </div>
            )}
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}

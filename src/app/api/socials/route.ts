import { NextRequest, NextResponse } from "next/server";

import { siteConfig } from "@portfolio/site.config";

import { rateLimit } from "@/lib/rate-limit";
import { extractClientIp } from "@/lib/security/client-ip";

/**
 * GET /api/socials?github=username&twitter=username&linkedin=username&...
 *
 * Fetches social preview data for the portfolio hero cards.
 * Accepts optional query params to override the static config (for dynamic user portfolios).
 * Falls back to static siteConfig values if no query params provided.
 *
 * Security (Finding 7): rate-limited per IP. Each request fans out to up to
 * 5 parallel outbound third-party APIs, so without rate limiting this endpoint
 * is a free DoS amplifier and a way to drain GitHub's 60-req/hr unauth quota.
 */

interface SocialEntry {
  username: string;
  label?: string;
  url?: string;
}

// Per-platform username validation patterns
const usernamePatterns: Record<string, RegExp> = {
  github: /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/,
  twitter: /^[a-zA-Z0-9_]{1,15}$/,
  linkedin: /^[a-zA-Z0-9-]{1,100}$/,
  leetcode: /^[a-zA-Z0-9_-]{1,50}$/,
  codeforces: /^[a-zA-Z0-9._-]{1,24}$/,
  tryhackme: /^[a-zA-Z0-9._-]{1,50}$/,
};

function getSocial(
  platform: string,
  searchParams: URLSearchParams,
): SocialEntry | null {
  // Check query params first (dynamic portfolio)
  const paramUser = searchParams.get(platform);
  if (paramUser) {
    const pattern = usernamePatterns[platform];
    if (pattern && !pattern.test(paramUser)) return null;
    return { username: paramUser };
  }

  // Fall back to static config
  const entry = (siteConfig.socials as Record<string, SocialEntry | null>)?.[platform];
  if (entry?.username) return entry;

  return null;
}

async function fetchJson(url: string, timeoutMs = 3000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return res.json();
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

export async function GET(req: NextRequest) {
  try {
    // Rate-limit per IP — 30 req/min (Finding 7).
    const ip = extractClientIp(req);
    const rl = await rateLimit(`socials:${ip}`, 30);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      );
    }

    const { searchParams } = req.nextUrl;

    // Resolve identity name for fallback display
    const identityName = searchParams.get("name") || siteConfig.identity.name;
    const identityTitle = siteConfig.identity.title;
    const identityTagline = siteConfig.identity.tagline;

    const github = getSocial("github", searchParams);
    const twitter = getSocial("twitter", searchParams);
    const codeforces = getSocial("codeforces", searchParams);
    const leetcode = getSocial("leetcode", searchParams);
    const linkedin = getSocial("linkedin", searchParams);
    const tryhackme = getSocial("tryhackme", searchParams);

    const fallbackAvatar = github?.username
      ? `https://github.com/${github.username}.png`
      : "";

    const [githubRes, twitterRes, codeforcesRes, leetcodeProfileRes, leetcodeSolvedRes] = await Promise.allSettled([
      github?.username
        ? fetchJson(`https://api.github.com/users/${encodeURIComponent(github.username)}`)
        : Promise.resolve(null),
      twitter?.username
        ? fetchJson(`https://api.fxtwitter.com/${encodeURIComponent(twitter.username)}`)
        : Promise.resolve(null),
      codeforces?.username
        ? fetchJson(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(codeforces.username)}`)
        : Promise.resolve(null),
      leetcode?.username
        ? fetchJson(`https://alfa-leetcode-api.onrender.com/${encodeURIComponent(leetcode.username)}/`).catch(() => null)
        : Promise.resolve(null),
      leetcode?.username
        ? fetchJson(`https://alfa-leetcode-api.onrender.com/${encodeURIComponent(leetcode.username)}/solved`).catch(() => null)
        : Promise.resolve(null),
    ]);

    const githubData = githubRes.status === "fulfilled" ? githubRes.value : null;
    const twitterData = twitterRes.status === "fulfilled" ? twitterRes.value?.user || null : null;
    const cfData =
      codeforcesRes.status === "fulfilled" && codeforcesRes.value?.status === "OK"
        ? codeforcesRes.value.result?.[0] ?? null
        : null;
    const leetcodeData = leetcodeProfileRes.status === "fulfilled" ? leetcodeProfileRes.value : null;
    const leetcodeSolved = leetcodeSolvedRes.status === "fulfilled" ? leetcodeSolvedRes.value : null;

    const result: Record<string, any> = {};

    if (github?.username && githubData) {
      result.github = {
        name: githubData.name || githubData.login || identityName,
        username: githubData.login || github.username,
        avatar: githubData.avatar_url || fallbackAvatar,
        bio: githubData.bio || `${identityTitle} • ${identityTagline}`,
        location: githubData.location || "",
        stats: [
          { label: "Repositories", value: githubData.public_repos ?? 0 },
          { label: "Followers", value: githubData.followers ?? 0 },
        ],
      };
    }

    if (twitter?.username && twitterData) {
      result.twitter = {
        name: twitterData.name || identityName,
        username: twitterData.screen_name || twitter.username,
        avatar: twitterData.avatar_url?.replace("_normal", "") || fallbackAvatar,
        banner: twitterData.banner_url || null,
        bio: twitterData.description || `${identityTitle} • ${identityTagline}`,
        location: twitterData.location || "",
        stats: [
          { label: "Following", value: twitterData.following ?? 0 },
          { label: "Followers", value: twitterData.followers ?? 0 },
        ],
      };
    }

    if (linkedin?.username) {
      result.linkedin = {
        name: identityName,
        username: linkedin.username,
        avatar: fallbackAvatar,
        banner: null,
        bio: siteConfig.identity.bio,
        location: "",
        stats: [],
      };
    }

    if (leetcode?.username && leetcodeData) {
      result.leetcode = {
        name: leetcodeData.name || identityName,
        username: leetcodeData.username || leetcode.username,
        avatar: leetcodeData.avatar || fallbackAvatar,
        bio: leetcodeData.about || "Grinding problems between builds.",
        location: leetcodeData.country || "",
        stats: [
          { label: "Solved", value: leetcodeSolved?.solvedProblem ?? 0 },
        ],
      };
    }

    if (tryhackme?.username) {
      result.tryhackme = {
        name: identityName,
        username: tryhackme.username,
        avatar: fallbackAvatar,
        bio: "Learning offensive security and defensive tooling, one room at a time.",
        location: "",
        stats: [],
      };
    }

    if (codeforces?.username && cfData) {
      result.codeforces = {
        name: cfData.firstName
          ? `${cfData.firstName} ${cfData.lastName ?? ""}`.trim()
          : identityName,
        username: cfData.handle || codeforces.username,
        avatar: cfData.titlePhoto ? `https:${cfData.titlePhoto}`.replace("https:https:", "https:") : fallbackAvatar,
        bio: cfData.rank ? `${cfData.rank.charAt(0).toUpperCase()}${cfData.rank.slice(1)}` : "Competitive programmer",
        location: [cfData.city, cfData.country].filter(Boolean).join(", ") || "",
        stats: [
          { label: "Rating", value: cfData.rating ?? "—" },
          { label: "Max", value: cfData.maxRating ?? "—" },
        ],
      };
    }

    // Email (from query param or static config)
    const email = searchParams.get("email") || siteConfig.contact?.email;
    if (email) {
      result.email = {
        name: "Drop an Email",
        username: email,
        avatar: fallbackAvatar,
        bio: "Whether you have a question, a project idea, or just want to say hi, feel free to reach out!",
        location: "Inbox",
        stats: [],
      };
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[/api/socials]", error);
    return NextResponse.json({ error: "Failed to fetch data" }, { status: 500 });
  }
}

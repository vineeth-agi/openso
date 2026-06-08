import { NextRequest, NextResponse } from "next/server"

import { generateText } from "@/lib/ai/xai-compat-helper"
import { getConnectionAdmin } from "@/lib/connections"
import { createAdminClient } from "@/lib/insforge/admin"
import { getAuthUser } from "@/lib/insforge/server"
import { rateLimit } from "@/lib/rate-limit"
import { dailyLimit } from "@/lib/redis"
import { extractClientIp } from "@/lib/security/client-ip"

// ── Types ──

interface GithubRepo {
    name: string
    full_name: string
    description: string | null
    html_url: string
    language: string | null
    languages_url: string
    stargazers_count: number
    forks_count: number
    fork: boolean
    topics: string[]
    created_at: string
    updated_at: string
    pushed_at: string
    size: number
}

interface RepoLanguages {
    [language: string]: number
}

interface AnalysisResult {
    github_username: string
    github_languages: string[]
    github_stats: {
        total_repos: number
        total_stars: number
        total_forks: number
        top_topics: string[]
    }
    github_summary: string
    is_public: boolean              // whether this was a public-only analysis
}

// ── Helpers ──

/** Fetch all repos with pagination (works for both authenticated and public endpoints) */
async function fetchAllRepos(
    baseUrl: string,
    headers: Record<string, string>,
    maxPages = 10
): Promise<GithubRepo[]> {
    let allRepos: GithubRepo[] = []
    let page = 1
    while (true) {
        const sep = baseUrl.includes("?") ? "&" : "?"
        const res = await fetch(`${baseUrl}${sep}per_page=100&sort=pushed&page=${page}`, { headers })
        if (!res.ok) throw new Error(`GitHub repos API: ${res.status}`)
        const batch: GithubRepo[] = await res.json()
        allRepos = allRepos.concat(batch)
        if (batch.length < 100) break
        page++
        if (page > maxPages) break
    }
    return allRepos
}

/** Aggregate languages from repos (uses language detail URLs) */
async function aggregateLanguages(
    repos: GithubRepo[],
    headers: Record<string, string>,
    limit = 30
): Promise<string[]> {
    const languageTotals: Record<string, number> = {}
    const langPromises = repos.slice(0, limit).map(async (repo) => {
        try {
            const res = await fetch(repo.languages_url, { headers })
            if (res.ok) return (await res.json()) as RepoLanguages
        } catch { /* skip */ }
        return {} as RepoLanguages
    })

    const langResults = await Promise.all(langPromises)
    for (const langs of langResults) {
        for (const [lang, bytes] of Object.entries(langs)) {
            languageTotals[lang] = (languageTotals[lang] || 0) + (bytes as number)
        }
    }

    return Object.entries(languageTotals)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
        .map(([lang]) => lang)
}

/** Gather stats & topics from repos */
function gatherStats(repos: GithubRepo[], totalRepoCount: number) {
    const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0)
    const totalForks = repos.reduce((s, r) => s + r.forks_count, 0)
    const topicCounts: Record<string, number> = {}
    for (const repo of repos) {
        for (const t of repo.topics || []) {
            topicCounts[t] = (topicCounts[t] || 0) + 1
        }
    }
    const topTopics = Object.entries(topicCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 15)
        .map(([t]) => t)

    return {
        stats: { total_repos: totalRepoCount, total_stars: totalStars, total_forks: totalForks, top_topics: topTopics },
        totalStars,
        totalForks,
        topTopics,
    }
}

/** Build AI prompt and call xAI Grok */
async function generateSummary(
    username: string,
    userData: { bio?: string; public_repos?: number; followers?: number; created_at?: string },
    sortedLanguages: string[],
    topTopics: string[],
    totalStars: number,
    totalForks: number,
    repos: GithubRepo[],
    isPublic: boolean
): Promise<string> {
    const repoSummaries = repos.slice(0, 25).map(r => ({
        name: r.name,
        desc: r.description || "",
        lang: r.language || "N/A",
        stars: r.stargazers_count,
        topics: (r.topics || []).join(", "),
    }))

    const accessNote = isPublic
        ? "\nNote: This analysis is based on PUBLIC repositories only."
        : ""

    const aiPrompt = `You are a senior tech recruiter reviewing a developer's GitHub profile.
Analyze the following data and write a concise, professional summary (3-5 paragraphs, ~200 words) about this developer.
Cover: primary tech stack, areas of expertise, project patterns/themes, open-source involvement, and overall developer profile strength.
Write in third person, professional tone. Do NOT use markdown headings — just flowing paragraphs.${accessNote}

GitHub Username: ${username}
Bio: ${userData.bio || "N/A"}
Public Repos: ${userData.public_repos || "N/A"}
Followers: ${userData.followers || "N/A"}
Account Created: ${userData.created_at || "N/A"}

Top Languages (by bytes): ${sortedLanguages.join(", ")}

Top Topics: ${topTopics.join(", ")}

Stars: ${totalStars} | Forks: ${totalForks}

Repository Highlights:
${repoSummaries.map(r => `• ${r.name} — ${r.desc || "no description"} [${r.lang}] ⭐${r.stars} topics: ${r.topics || "none"}`).join("\n")}

Write the summary now:`

    return await generateText(aiPrompt)
}

// ── Route ──

export async function POST(request: NextRequest) {
    // 1. Auth — required (audit API-AUTH-1). The route invokes AI
    //    per request, so an unauthenticated caller could spend Pioneer
    //    AI quota at scale. Combine with per-IP rate-limit + per-user
    //    daily cap below for defense in depth.
    const auth = await getAuthUser();
    if (!auth) {
        return NextResponse.json(
            { error: "Authentication required" },
            { status: 401 },
        );
    }
    const userId = auth.user.id;

    // 2. Per-user daily cap (audit API-AUTH-1, remediation #3). Twenty
    //    generations / 24h / user. This is in addition to the per-IP
    //    rate-limit so a single signed-in attacker can't burn budget.
    const daily = await dailyLimit(`gh-analyze:user:${userId}`, 20);
    if (!daily.ok) {
        return NextResponse.json(
            {
                error: "Daily limit reached. Try again tomorrow.",
                limit: daily.limit,
                used: daily.used,
            },
            { status: 429, headers: { "Retry-After": String(60 * 60) } },
        );
    }

    // 3. Per-IP rate-limit: this route invokes xAI per request, so
    //    without a limit it's both an xAI cost amplifier and a
    //    GitHub API quota drain (Finding 21).
    const ip = extractClientIp(request);
    const rl = await rateLimit(`github-analyze:${ip}`, 5);
    if (!rl.ok) {
        return NextResponse.json(
            { error: "Too many requests" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
        );
    }

    let publicUsername: string | undefined
    try {
        const body = await request.json().catch(() => ({}))
        publicUsername = body.username  // for public analysis only
    } catch { /* no body */ }

    // 4. Resolve the GitHub access token from the user's connected
    //    GitHub App row (admin client — bypasses RLS using the
    //    service-role SDK; see `getConnectionAdmin`). Replaces the
    //    legacy `cookies().get("github_token")` cookie path which is
    //    no longer used. If the user has no connected GitHub row we
    //    fall back to the public-username path below.
    const ghConnection = await getConnectionAdmin(userId, "github");
    const token = ghConnection?.access_token ?? null;

    // If no token AND no public username provided, error
    if (!token && !publicUsername) {
        return NextResponse.json(
            { error: "Not connected to GitHub. Provide a username for public analysis." },
            { status: 401 },
        )
    }

    try {
        let username: string
        let userData: Record<string, unknown>
        let allRepos: GithubRepo[]
        let repos: GithubRepo[]
        let sortedLanguages: string[]
        const isPublic = !token || !!publicUsername

        if (token && !publicUsername) {
            // ═════ AUTHENTICATED PATH (private + public repos) ═════
            const authHeaders = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.v3+json" }

            // 1. Fetch user info
            const userRes = await fetch("https://api.github.com/user", { headers: authHeaders })
            if (!userRes.ok) throw new Error(`GitHub user API: ${userRes.status}`)
            userData = await userRes.json()
            username = userData.login as string

            // 2. Fetch all repos (authenticated — includes private)
            allRepos = await fetchAllRepos(
                "https://api.github.com/user/repos?type=owner",
                authHeaders
            )
            repos = allRepos.filter(r => !r.fork)

            // 3. Languages (authenticated — higher rate limit)
            sortedLanguages = await aggregateLanguages(repos, authHeaders, 30)
        } else {
            // ═════ PUBLIC PATH (public repos only, no auth required) ═════
            username = publicUsername!
            const pubHeaders = { Accept: "application/vnd.github.v3+json" }

            // 1. Fetch public user info
            const userRes = await fetch(
                `https://api.github.com/users/${encodeURIComponent(username)}`,
                { headers: pubHeaders }
            )
            if (!userRes.ok) {
                if (userRes.status === 404) throw new Error("GitHub user not found")
                throw new Error(`GitHub public user API: ${userRes.status}`)
            }
            userData = await userRes.json()

            // 2. Fetch public repos
            allRepos = await fetchAllRepos(
                `https://api.github.com/users/${encodeURIComponent(username)}/repos?type=owner`,
                pubHeaders,
                5 // limit pages for public (rate limit: 60/hr unauthenticated)
            )
            repos = allRepos.filter(r => !r.fork)

            // 3. Languages — use primary language field to avoid burning rate limit
            //    For public we skip individual language URLs and use repo.language
            const langCounts: Record<string, number> = {}
            for (const r of repos) {
                if (r.language) {
                    langCounts[r.language] = (langCounts[r.language] || 0) + r.size
                }
            }
            sortedLanguages = Object.entries(langCounts)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 20)
                .map(([lang]) => lang)
        }

        // 4. Stats & topics
        const totalRepoCount = (userData.public_repos as number || 0)
            + (!isPublic ? (userData.owned_private_repos as number || 0) : 0)
            || allRepos.length
        const { stats, totalStars, totalForks, topTopics } = gatherStats(repos, totalRepoCount)

        // 5. AI summary
        const summary = await generateSummary(
            username, userData as Record<string, string>,
            sortedLanguages, topTopics, totalStars, totalForks, repos, isPublic
        )

        // 6. Persist to DB (only for authenticated connections)
        if (userId && !isPublic) {
            try {
                const adminDb = createAdminClient()
                const { error: dbError } = await adminDb
                    .database.from("profiles")
                    .update({
                        github_connected: true,
                        github_username: username,
                        github_languages: sortedLanguages,
                        github_stats: stats,
                        github_summary: summary,
                        updated_at: new Date().toISOString(),
                    })
                    .eq("id", userId)
                if (dbError) console.error("DB update error:", dbError)
            } catch (dbErr) {
                console.error("Failed to persist GitHub analysis:", dbErr)
            }
        }

        const result: AnalysisResult = {
            github_username: username,
            github_languages: sortedLanguages,
            github_stats: stats,
            github_summary: summary,
            is_public: isPublic,
        }

        return NextResponse.json(result, {
            headers: { "Cache-Control": isPublic ? "public, s-maxage=3600" : "private, max-age=1800" },
        })

    } catch (error) {
        console.error("GitHub analysis error:", error)
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Failed to analyze GitHub profile" },
            { status: 500 }
        )
    }
}


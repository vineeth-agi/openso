import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

import { rateLimit } from "@/lib/rate-limit"
import { extractClientIp } from "@/lib/security/client-ip"

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql"

interface GitHubContributionDay {
    contributionCount: number
    contributionLevel: "NONE" | "FIRST_QUARTILE" | "SECOND_QUARTILE" | "THIRD_QUARTILE" | "FOURTH_QUARTILE"
    date: string
    color: string
}

interface GitHubWeek {
    contributionDays: GitHubContributionDay[]
}

type ContributionCell = {
    date: string
    contributionCount: number
    contributionLevel: string
    color: string
}

// ── GraphQL query (full data, requires auth) ──
const CONTRIBUTION_QUERY = `
query($username: String!, $from: DateTime, $to: DateTime) {
  user(login: $username) {
    createdAt
    contributionsCollection(from: $from, to: $to) {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays {
            contributionCount
            contributionLevel
            date
            color
          }
        }
      }
    }
  }
}
`

// ── Level mapping for public scrape ──
const LEVEL_MAP: Record<number, string> = {
    0: "NONE",
    1: "FIRST_QUARTILE",
    2: "SECOND_QUARTILE",
    3: "THIRD_QUARTILE",
    4: "FOURTH_QUARTILE",
}

// ── Public fallback: scrape GitHub's contribution HTML (no auth needed) ──
async function fetchPublicContributions(username: string, year?: string | null) {
    const now = new Date()
    const currentYear = now.getFullYear()

    // Build contributions URL
    let url = `https://github.com/users/${encodeURIComponent(username)}/contributions`
    if (year) {
        const y = parseInt(year, 10)
        const to = y >= currentYear ? now.toISOString().split("T")[0] : `${y}-12-31`
        url += `?from=${y}-01-01&to=${to}`
    }

    const res = await fetch(url, {
        headers: {
            Accept: "text/html",
            "X-Requested-With": "XMLHttpRequest",
        },
    })

    if (!res.ok) {
        if (res.status === 404) throw new Error("GitHub user not found")
        throw new Error(`GitHub returned ${res.status}`)
    }

    const html = await res.text()

    // Parse contribution cells: <td ... data-date="YYYY-MM-DD" ... data-level="N" ...>
    const days: { date: string; level: number; count: number }[] = []
    const cellRegex = /data-date="(\d{4}-\d{2}-\d{2})"[^>]*?data-level="(\d)"/g
    let match

    while ((match = cellRegex.exec(html)) !== null) {
        const date = match[1]
        const level = parseInt(match[2])
        // Try to extract exact count from sr-only text nearby
        const snippet = html.substring(match.index, match.index + 500)
        const countMatch = snippet.match(/(\d+)\s+contribution/)
        const count = countMatch ? parseInt(countMatch[1]) : (level === 0 ? 0 : Math.max(1, level * 2 - 1))

        days.push({ date, level, count })
    }

    if (days.length === 0) {
        throw new Error("No contribution data found — username may not exist")
    }

    // Sort chronologically
    days.sort((a, b) => a.date.localeCompare(b.date))

    // Group into week columns (each starts on Sunday)
    const weeks: ContributionCell[][] = []
    let currentWeek: ContributionCell[] = []

    for (const day of days) {
        const dow = new Date(day.date + "T12:00:00Z").getUTCDay() // 0 = Sunday
        if (dow === 0 && currentWeek.length > 0) {
            weeks.push(currentWeek)
            currentWeek = []
        }
        currentWeek.push({
            date: day.date,
            contributionCount: day.count,
            contributionLevel: LEVEL_MAP[day.level] || "NONE",
            color: "",
        })
    }
    if (currentWeek.length > 0) weeks.push(currentWeek)

    // Try to extract total from HTML heading (e.g. "1,234 contributions in the last year")
    const totalMatch = html.match(/([\d,]+)\s+contributions?\s/)
    const totalContributions = totalMatch
        ? parseInt(totalMatch[1].replace(/,/g, ""))
        : days.reduce((sum, d) => sum + d.count, 0)

    // Get available years from public REST API (no auth, 60 req/hr rate limit)
    let startYear = currentYear
    try {
        const userRes = await fetch(
            `https://api.github.com/users/${encodeURIComponent(username)}`,
            { headers: { Accept: "application/vnd.github.v3+json" } }
        )
        if (userRes.ok) {
            const userData = await userRes.json()
            startYear = new Date(userData.created_at).getFullYear()
        }
    } catch {
        /* use currentYear as fallback */
    }

    const availableYears: number[] = []
    for (let y = currentYear; y >= startYear; y--) {
        availableYears.push(y)
    }

    return { contributions: weeks, totalContributions, availableYears }
}

// ── Authenticated fetch via GraphQL (full data incl. private contributions) ──
async function fetchAuthenticatedContributions(
    username: string,
    token: string,
    year?: string | null
) {
    const variables: Record<string, string> = { username }
    if (year) {
        const y = parseInt(year, 10)
        const now = new Date()
        const currentYear = now.getFullYear()
        variables.from = `${y}-01-01T00:00:00Z`
        if (y >= currentYear) {
            variables.to = now.toISOString()
        } else {
            variables.to = `${y}-12-31T23:59:59Z`
        }
    }

    const response = await fetch(GITHUB_GRAPHQL_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: CONTRIBUTION_QUERY, variables }),
    })

    if (!response.ok) {
        throw new Error(`GitHub API responded with ${response.status}`)
    }

    const data = await response.json()
    if (data.errors) {
        throw new Error(data.errors[0]?.message || "GitHub GraphQL error")
    }

    const user = data.data.user
    const calendar = user.contributionsCollection.contributionCalendar
    const totalContributions: number = calendar.totalContributions
    const createdAt: string = user.createdAt

    const contributions = calendar.weeks.map((week: GitHubWeek) =>
        week.contributionDays.map((day: GitHubContributionDay) => ({
            date: day.date,
            contributionCount: day.contributionCount,
            contributionLevel: day.contributionLevel,
            color: day.color,
        }))
    )

    const startYear = new Date(createdAt).getFullYear()
    const currentYear = new Date().getFullYear()
    const availableYears: number[] = []
    for (let y = currentYear; y >= startYear; y--) {
        availableYears.push(y)
    }

    return { contributions, totalContributions, availableYears }
}

// ── Route handler ──
export async function GET(request: NextRequest) {
    // Rate-limit per IP. Without this, the unauthenticated GitHub API quota
    // (60/hr/IP) is a single attacker shell-loop away (Finding 21).
    const ip = extractClientIp(request);
    const rl = await rateLimit(`gh-contrib:${ip}`, 30);
    if (!rl.ok) {
        return NextResponse.json(
            { error: "Too many requests" },
            { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
        );
    }

    const { searchParams } = new URL(request.url)
    const username = searchParams.get("username")
    const year = searchParams.get("year") || null

    if (!username) {
        return NextResponse.json(
            { error: "Username is required" },
            { status: 400 }
        )
    }

    const token = (await cookies()).get("github_token")?.value

    try {
        let result

        if (token) {
            // Authenticated: use GraphQL (includes private contribution counts)
            // Falls back to public scraping if token is expired/invalid
            try {
                result = await fetchAuthenticatedContributions(username, token, year)
            } catch (authError) {
                console.warn("Authenticated GitHub fetch failed, falling back to public scrape:", authError)
                result = await fetchPublicContributions(username, year)
            }
        } else {
            // Public fallback: scrape GitHub's HTML (public contributions only)
            result = await fetchPublicContributions(username, year)
        }

        return NextResponse.json(result, {
            headers: {
                "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=1800",
            },
        })
    } catch (error) {
        console.error("GitHub contributions fetch error:", error)
        return NextResponse.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to fetch contributions",
            },
            { status: 500 }
        )
    }
}

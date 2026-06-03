import { Suspense } from "react";

import { ContributionGraphServer } from "./contribution-graph-server";
import Layout from "@portfolio/components/layout/layout";
import Hero from "@portfolio/components/sections/hero";

import { getCachedPortfolio } from "@/lib/portfolio-data";
import type { PortfolioSiteConfig } from "@/lib/profile/portfolio-types";


// Revalidate every 60 seconds so user edits appear quickly.
// On save / publish we also eagerly invalidate via /api/revalidate.
export const revalidate = 60;

interface Props {
  params: Promise<{ username: string }>;
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export default async function UserPortfolioPage({ params }: Props) {
  const { username } = await params;

  // Cached — shares the same database call as the layout (React cache dedup)
  const data = await getCachedPortfolio(username);

  const config = data?.site_config as unknown as PortfolioSiteConfig | undefined;
  const githubUser = config?.socials?.github?.username;

  return (
    <div className="overflow-x-hidden">
      <Layout>
        <Hero>
          {/* Async server component inside Suspense — page streams instantly,
              graph loads independently without blocking the rest of the page */}
          <Suspense fallback={
            <div className="h-[140px] w-full animate-pulse rounded-lg bg-muted/30" />
          }>
            <ContributionGraphServer githubUser={githubUser} userId={data?.user_id ?? null} />
          </Suspense>
        </Hero>
      </Layout>
    </div>
  );
}

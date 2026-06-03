import Layout from "@portfolio/components/layout/layout";
import HackathonList from "@portfolio/components/sections/hackathons";

import { getCachedPortfolio } from "@/lib/portfolio-data";
import type { PortfolioSiteConfig } from "@/lib/profile/portfolio-types";

export const revalidate = 3600;

interface Props {
  params: Promise<{ username: string }>;
}

export default async function UserHackathonsPage({ params }: Props) {
  const { username } = await params;

  const data = await getCachedPortfolio(username);
  const config = data?.site_config as unknown as PortfolioSiteConfig | undefined;
  const hackathons = config?.hackathons ?? [];

  return (
    <Layout
      showHeader
      title="Hackathons"
      subtitle="Competitions, bounties, and builds under pressure."
    >
      <HackathonList hackathons={hackathons} />
    </Layout>
  );
}

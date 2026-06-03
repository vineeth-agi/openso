import Layout from "@portfolio/components/layout/layout";
import ResearchList from "@portfolio/components/sections/research-list";

import { getCachedPortfolio } from "@/lib/portfolio-data";
import type { PortfolioSiteConfig } from "@/lib/profile/portfolio-types";

export const revalidate = 3600;

interface Props {
  params: Promise<{ username: string }>;
}

export default async function UserResearchPage({ params }: Props) {
  const { username } = await params;

  const data = await getCachedPortfolio(username);
  const config = data?.site_config as unknown as PortfolioSiteConfig | undefined;
  const research = config?.research ?? [];

  return (
    <Layout
      showHeader
      title="Research"
      subtitle="Academic research, publications, and experimental projects"
    >
      <ResearchList research={research} />
    </Layout>
  );
}

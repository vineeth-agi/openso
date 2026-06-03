import Layout from "@portfolio/components/layout/layout";
import Timeline from "@portfolio/components/layout/timeline";

import { getCachedPortfolio } from "@/lib/portfolio-data";
import type { PortfolioSiteConfig } from "@/lib/profile/portfolio-types";

export const revalidate = 3600;

interface Props {
  params: Promise<{ username: string }>;
}

export default async function UserExperiencePage({ params }: Props) {
  const { username } = await params;

  const data = await getCachedPortfolio(username);
  const config = data?.site_config as unknown as PortfolioSiteConfig | undefined;
  const experiences = config?.experiences ?? [];

  const totalYears = (() => {
    if (!experiences.length) return 0;
    const earliest = experiences
      .map((e) => new Date(e.year.split(" - ")[0]))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    return Math.floor(
      (Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24 * 365.25),
    );
  })();

  return (
    <Layout
      showHeader
      title="Experiences"
      subtitle={`My journey as a software developer${totalYears > 0 ? ` over ${totalYears}+ years` : ""}`}
    >
      {experiences.length > 0 ? (
        <div>
          {[...experiences].reverse().map((experience, index) => (
            <Timeline {...experience} key={index} index={index} />
          ))}
        </div>
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">No experiences to show yet.</p>
      )}
    </Layout>
  );
}

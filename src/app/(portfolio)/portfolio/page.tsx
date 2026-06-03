import Layout from "@portfolio/components/layout/layout";
import GitHubContributionGraph from "@portfolio/components/sections/contribution-graph";
import Hero from "@portfolio/components/sections/hero";
import { fetchGitHubContributions } from "@portfolio/lib/github";

export const revalidate = 3600;

export const metadata = {
  title: "Portfolio",
  description: "Personal Portfolio",
};

export default async function PortfolioPage() {
  const { contributions, lifetimeTotal } = await fetchGitHubContributions();

  return (
    <div className="overflow-x-hidden">
      <Layout>
        <Hero>
          <GitHubContributionGraph
            data={contributions}
            lifetimeTotal={lifetimeTotal}
          />
        </Hero>
      </Layout>
    </div>
  );
}

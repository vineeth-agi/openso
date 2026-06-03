import Layout from "@portfolio/components/layout/layout";
import ProjectCard from "@portfolio/components/sections/projects";
import { fetchGitHubStars } from "@portfolio/lib/github";

import { getCachedPortfolio } from "@/lib/portfolio-data";
import type { PortfolioSiteConfig } from "@/lib/profile/portfolio-types";

export const revalidate = 3600;

interface Props {
  params: Promise<{ username: string }>;
}

export default async function UserProjectsPage({ params }: Props) {
  const { username } = await params;

  const data = await getCachedPortfolio(username);
  const config = data?.site_config as unknown as PortfolioSiteConfig | undefined;
  const projects = config?.projects ?? [];

  const projectsWithStars = await Promise.all(
    projects.map(async (project) => {
      if (!project.github) return { ...project, stars: null };
      const stars = await fetchGitHubStars(project.github);
      return { ...project, stars };
    }),
  );

  return (
    <Layout showHeader title="Projects" subtitle="A collection of things I've built.">
      {projectsWithStars.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projectsWithStars.map((project, index) => (
            <ProjectCard key={index} index={index} {...project} />
          ))}
        </div>
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">No projects to show yet.</p>
      )}
    </Layout>
  );
}

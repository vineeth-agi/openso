import Layout from "@portfolio/components/layout/layout";
import ProjectCard from "@portfolio/components/sections/projects";
import { projects } from "@portfolio/constants";
import { fetchGitHubStars } from "@portfolio/lib/github";

export const metadata = {
  title: "Projects | Portfolio",
  description:
    "Explore my latest projects, including web applications, open-source tools, and experiments in technology and programming.",
};

const Projects = async () => {
  const projectsWithStars = await Promise.all(
    projects.map(async (project) => {
      if (!project.github) return { ...project, stars: null };
      const stars = await fetchGitHubStars(project.github);
      return { ...project, stars };
    })
  );

  return (
    <Layout
      showHeader
      title="Projects"
      subtitle="A collection of things I've built."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projectsWithStars.map((project, index) => (
          <ProjectCard key={index} index={index} {...project} />
        ))}
      </div>
    </Layout>
  );
};

export default Projects;

import Layout from "@portfolio/components/layout/layout";
import ResearchList from "@portfolio/components/sections/research-list";
import { research } from "@portfolio/constants";

export const metadata = {
  title: "Research | Portfolio",
  description:
    "Academic research, publications, and experimental projects in software engineering and technology.",
};

const Research = () => {
  return (
    <Layout
      showHeader
      title="Research"
      subtitle="Academic research, publications, and experimental projects"
    >
      <ResearchList research={research} />
    </Layout>
  );
};

export default Research;

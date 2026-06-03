import Layout from "@portfolio/components/layout/layout";
import Timeline from "@portfolio/components/layout/timeline";
import { experiences } from "@portfolio/constants";

export const metadata = {
  title: "Experience | Portfolio",
  description:
    "Professional experience and career journey as a full stack developer working with modern web technologies.",
};

const getExperienceYears = () => {
  const earliest = experiences
    .map((e) => new Date(e.year.split(" - ")[0]))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const years = (new Date().getTime() - earliest.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.floor(years);
};

const Experience = () => {
  const totalYears = getExperienceYears();

  return (
    <Layout
      showHeader
      title="Experiences"
      subtitle={`My journey as a software developer over ${totalYears}+ years`}
    >
      <div>
        {[...experiences].reverse().map((experience, index) => (
          <Timeline {...experience} key={index} index={index} />
        ))}
      </div>
    </Layout>
  );
};

export default Experience;

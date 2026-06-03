import Layout from "@portfolio/components/layout/layout";
import HackathonList from "@portfolio/components/sections/hackathons";
import { hackathons } from "@portfolio/constants";

export const metadata = {
  title: "Hackathons | Portfolio",
  description:
    "Hackathon participations, competitions, bounties, and builds under pressure.",
};

const Hackathons = () => {
  return (
    <Layout
      showHeader
      title="Hackathons"
      subtitle="Competitions, bounties, and builds under pressure."
    >
      <HackathonList hackathons={hackathons} />
    </Layout>
  );
};

export default Hackathons;

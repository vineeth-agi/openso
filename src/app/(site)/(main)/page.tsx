import { FaqsSection } from "@/components/faqs-page";
import { FeatureSection } from "@/components/feature-section";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { Integrations3 } from "@/components/integrations-logos";
import { HeroSection } from "@/components/marketing/hero-1";

export default function Home() {
  return (
    <main>
      <Header />
      <HeroSection />
      <FeatureSection />
      <Integrations3 />
      <FaqsSection />
      <Footer />
    </main>
  );
}


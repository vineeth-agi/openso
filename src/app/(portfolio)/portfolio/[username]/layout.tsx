/**
 * Dynamic portfolio layout for /portfolio/[username]
 *
 * Fetches the user's site_config from DB and injects it via
 * PortfolioConfigProvider so all child components use the user's
 * data instead of the static siteConfig.
 */

import type { ReactNode } from "react";

import { notFound } from "next/navigation";

import { ChatWidget } from "@portfolio/components/chat-widget";
import { PortfolioConfigProvider } from "@portfolio/components/portfolio-config-context";
import NavigationBar from "@portfolio/components/sections/navigation";

import { getCachedPortfolio } from "@/lib/portfolio-data";
import type { PortfolioSiteConfig } from "@/lib/profile/portfolio-types";

interface Props {
  children: ReactNode;
  params: Promise<{ username: string }>;
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const data = await getCachedPortfolio(username);

  if (!data) return {};

  const config = data.site_config as unknown as PortfolioSiteConfig;
  const name = data.display_name ?? config?.identity?.name ?? username;

  return {
    title: `${name} | Portfolio`,
    description: data.bio ?? config?.identity?.bio ?? "",
  };
}

export default async function UserPortfolioLayout({ children, params }: Props) {
  const { username } = await params;
  const data = await getCachedPortfolio(username);

  if (!data?.site_config) notFound();

  const config = data.site_config as unknown as PortfolioSiteConfig;

  // Ensure avatar_url from the DB row is available in the config
  if (data.avatar_url && !config.avatarUrl) {
    config.avatarUrl = data.avatar_url;
  }

  const portfolioIdentityName = nonEmpty(config?.identity?.name);
  const resume = data?.resume_structured as
    | { name?: unknown }
    | null
    | undefined;
  const resumeName = nonEmpty(resume?.name);
  const candidateName = resumeName ?? portfolioIdentityName ?? username;

  return (
    <PortfolioConfigProvider config={config}>
      {children}
      <ChatWidget username={username} candidateName={candidateName} />
      <NavigationBar forceRender />
    </PortfolioConfigProvider>
  );
}
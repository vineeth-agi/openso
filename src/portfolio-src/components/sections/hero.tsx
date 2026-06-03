"use client";
import React, { useState, useEffect } from "react";

import Image from "next/image";
import Link from "next/link";

import { GeistPixelSquare } from "geist/font/pixel";
import { FileText, Check, Calendar, ArrowUpRight, Globe } from "lucide-react";
import { motion, AnimatePresence, useMotionValue, useSpring } from "motion/react";
import { IoIosMail } from "react-icons/io";
import { SiLeetcode, SiCodeforces, SiTryhackme } from "react-icons/si";
import { toast } from "sonner";



import GitHubContributionGraph from "./contribution-graph";
import GithubIcon from "@portfolio/components/icons/github";
import LinkedinIcon from "@portfolio/components/icons/linkedin";
import { CornerBrackets } from "@portfolio/components/ui/corner-brackets";
import { type SocialPlatform } from "@portfolio/site.config";
import { usePortfolioConfig } from "@portfolio/components/portfolio-config-context";

const socialIcons: Record<SocialPlatform, React.ReactNode> = {
  twitter: <XTwitterIcon className="h-3.5 w-3.5" />,
  github: <GithubIcon className="h-3.5 w-3.5" />,
  linkedin: <LinkedinIcon className="h-3.5 w-3.5" />,
  leetcode: <SiLeetcode className="h-3.5 w-3.5" />,
  tryhackme: <SiTryhackme className="h-3.5 w-3.5" />,
  codeforces: <SiCodeforces className="h-3.5 w-3.5" />,
};

import LocationIcon from "@portfolio/components/icons/location";
import XTwitterIcon from "@portfolio/components/icons/x-twitter";
import { Button } from "@portfolio/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@portfolio/components/ui/tooltip";

/**
 * fadeUp animation props.
 * Server renders with NO initial style (content visible by default).
 * Client hydration triggers the entrance animation via useEffect.
 */
const fadeUp = (delay = 0): any => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] },
});



function SocialPreviewCard({ loading, data, platform, username }: any) {


  if (loading) {
    return (
      <div className="flex w-[320px] flex-col gap-4 font-space-mono animate-pulse">
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-muted"></div>
          <div className="flex flex-col gap-2">
            <div className="h-4 w-32 rounded-sm bg-muted"></div>
            <div className="h-3 w-20 rounded-sm bg-muted"></div>
          </div>
        </div>
        <div className="h-10 w-full rounded-sm bg-muted"></div>
        <div className="h-4 w-24 rounded-sm bg-muted"></div>
        <div className="mt-2 flex gap-4">
          <div className="h-4 w-16 rounded-sm bg-muted"></div>
          <div className="h-4 w-16 rounded-sm bg-muted"></div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex w-[320px] flex-col gap-2 font-space-mono text-left">
      {data.banner && (
        <div className="-mx-4 -mt-4 mb-2 h-20 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={data.banner} alt="Banner" className="h-full w-full object-cover" />
        </div>
      )}
      <div className={`flex gap-3 relative z-10 ${data.banner ? "flex-col items-start -mt-12" : "items-center"}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={data.avatar || ""}
          alt={data.name}
          className={`rounded-full object-cover bg-background ${data.banner ? "h-[68px] w-[68px] border-[3px] border-card" : "h-14 w-14 border border-border"}`}
        />
        <div className={`flex flex-col ${data.banner ? "-mt-1" : ""}`}>
          <span className="font-doto text-base font-bold text-foreground">
            {data.name}
          </span>
          <span className="text-sm text-muted-foreground">
            {data.username}
          </span>
        </div>
      </div>
      {data.bio && (
        <p className="text-sm text-foreground line-clamp-3">
          {data.bio}
        </p>
      )}
      {data.location && (
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <LocationIcon className="h-4 w-4 shrink-0" />
          <span className="line-clamp-1">{data.location}</span>
        </div>
      )}
      {data.stats && data.stats.length > 0 && (
        <div className="mt-2 flex gap-4 text-sm text-muted-foreground">
          {data.stats.map((stat: any, i: number) => (
            <span key={i}>
              <strong className="font-doto font-semibold text-foreground">
                {stat.value}
              </strong>{" "}
              {stat.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SocialHoverTooltip({ platform, username, data, loading, clientX, clientY }: any) {
  const x = useMotionValue(clientX - 160);
  const y = useMotionValue(clientY + 12);

  const springConfig = { damping: 25, stiffness: 150, mass: 0.5 };
  const springX = useSpring(x, springConfig);
  const springY = useSpring(y, springConfig);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      x.set(e.clientX - 160);
      y.set(e.clientY + 12);
    };
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [x, y]);

  return (
    <motion.div
      initial={{ opacity: 0, x: -10, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -10, scale: 0.95 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className="flex w-[320px] flex-col gap-3 rounded-xl overflow-hidden bg-background/30 backdrop-blur-2xl backdrop-saturate-150 p-4 shadow-2xl border border-white/20 dark:border-white/10"
      style={{
        position: "fixed",
        left: springX,
        top: springY,
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      <SocialPreviewCard platform={platform} username={username} data={data} loading={loading} />
    </motion.div>
  );
}

function SocialButton({ label, href, icon, endIcon, external, platform, username, data, loading, copyText }: any) {
  const [isHovered, setIsHovered] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });

  const handleMouseEnter = (e: React.MouseEvent) => {
    setCoords({ x: e.clientX, y: e.clientY });
    setIsHovered(true);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(copyText);
    toast.success("Copied to clipboard", {
      description: copyText,
      icon: <Check className="h-4 w-4" />,
      classNames: { description: "font-space-mono" },
    });
  };

  const content = copyText ? (
    <CornerBrackets>
      <Button size="sm" variant="noShadow" onClick={handleCopy}>
        {icon}
        <span className="ml-1.5">{label}</span>
        {endIcon && <span className="ml-1.5">{endIcon}</span>}
      </Button>
    </CornerBrackets>
  ) : (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
    >
      <CornerBrackets>
        <Button size="sm" variant="noShadow">
          {icon}
          <span className="ml-1.5">{label}</span>
          {endIcon && <span className="ml-1.5">{endIcon}</span>}
        </Button>
      </CornerBrackets>
    </Link>
  );

  if (platform && username) {
    return (
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setIsHovered(false)}
        className="relative"
      >
        {content}
        <AnimatePresence>
          {isHovered && (
            <SocialHoverTooltip
              platform={platform}
              username={username}
              data={data}
              loading={loading}
              clientX={coords.x}
              clientY={coords.y}
            />
          )}
        </AnimatePresence>
      </div>
    );
  }

  return content;
}

const WaveEmoji = () => {
  const [phase, setPhase] = useState<string>("idle");
  const [key, setKey] = useState(0);

  useEffect(() => {
    setPhase("waving");
    const timer = setTimeout(() => setPhase("grayscale"), 700);
    return () => clearTimeout(timer);
  }, []);

  const handleMouseEnter = () => {
    setKey((k) => k + 1);
    setPhase("hover-wave");
  };

  const handleMouseLeave = () => {
    setPhase("grayscale");
  };

  const isWaving = phase === "waving" || phase === "hover-wave";
  const isGrayscale = phase === "grayscale";

  return (
    <span
      key={key}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`inline-block origin-[70%_70%] cursor-default transition-all duration-500 ${isWaving ? "animate-wave-slow" : ""} ${isGrayscale ? "grayscale" : ""}`}
    >
      👋🏻
    </span>
  );
};

interface HeroProps {
  children?: React.ReactNode;
}

const Hero = ({ children }: HeroProps) => {
  const siteConfig = usePortfolioConfig();
  const [socialData, setSocialData] = useState<any>(null);
  const [socialsLoading, setSocialsLoading] = useState(true);

  const socialLinks = (Object.entries(siteConfig.socials) as [SocialPlatform, (typeof siteConfig.socials)[SocialPlatform]][])
    .filter(([, s]) => s && s.username && s.url)
    .map(([platform, s]) => ({
      label: s!.label,
      href: s!.url,
      icon: socialIcons[platform],
      external: true,
      platform,
      username: s!.username,
    }));

  const connectLinks = [
    ...(siteConfig.contact.calUrl
      ? [{
          label: "schedule a meet",
          href: siteConfig.contact.calUrl,
          icon: <Calendar className="h-3.5 w-3.5" />,
          endIcon: <ArrowUpRight className="h-3 w-3" />,
          external: true,
        }]
      : []),
    ...(siteConfig.contact.url
      ? [{
          label: "Website",
          href: siteConfig.contact.url,
          icon: <Globe className="h-3.5 w-3.5" />,
          external: true,
        }]
      : []),
    ...(siteConfig.contact.email
      ? [{
          label: "Email",
          icon: <IoIosMail size="14px" />,
          copyText: siteConfig.contact.email,
        }]
      : []),
    ...(siteConfig.contact.resumeUrl
      ? [{
          label: "Resume",
          href: siteConfig.contact.resumeUrl,
          icon: <FileText className="h-3.5 w-3.5" />,
          external: true,
        }]
      : []),
  ];

  const queryStr = React.useMemo(() => {
    const params = new URLSearchParams();
    const socials = (siteConfig.socials || {}) as Record<string, { username?: string } | null>;
    for (const [platform, entry] of Object.entries(socials)) {
      if (entry?.username) params.set(platform, entry.username);
    }
    if (siteConfig.identity?.name) params.set("name", siteConfig.identity.name);
    if (siteConfig.contact?.email) params.set("email", siteConfig.contact.email);
    return params.toString();
  }, [JSON.stringify(siteConfig.socials), siteConfig.identity?.name, siteConfig.contact?.email]);

  useEffect(() => {
    if (!queryStr) return;
    const controller = new AbortController();
    setSocialsLoading(true);

    fetch(`/api/socials?${queryStr}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (!data.error) {
          setSocialData(data);
        }
        setSocialsLoading(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setSocialsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [queryStr]);

  return (
    <div className="mx-auto flex flex-col gap-10 md:max-w-4xl">
      <motion.div className="flex flex-col gap-3" {...fadeUp(0)}>
        <p className="font-doto text-xs text-muted-foreground md:text-sm">
          Hola I&apos;m <WaveEmoji />
        </p>

        <div className="flex flex-row items-center justify-between gap-4">
          <div className={`min-w-0 ${GeistPixelSquare.className}`}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-2xl font-bold uppercase tracking-tight md:text-4xl">
                {siteConfig.identity.name}
              </h1>

            </div>

            <p className="mt-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground md:text-sm">
              {siteConfig.identity.title} &bull; {siteConfig.identity.tagline}
            </p>
          </div>

          {(siteConfig as any).avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={(siteConfig as any).avatarUrl}
              alt={siteConfig.identity.name}
              className="h-20 w-20 shrink-0 rounded-full border border-border object-cover md:h-28 md:w-28"
            />
          ) : siteConfig.assetsUrl ? (
            <>
              <Image
                src={`${siteConfig.assetsUrl}/profpic2.jpg`}
                alt={siteConfig.identity.name}
                width={128}
                height={128}
                priority
                className="h-20 w-20 shrink-0 rounded-full border border-black/8 object-cover dark:hidden md:h-28 md:w-28"
              />
              <Image
                src={`${siteConfig.assetsUrl}/profpic.jpg`}
                alt={siteConfig.identity.name}
                width={128}
                height={128}
                priority
                className="hidden h-20 w-20 shrink-0 rounded-full border border-white/8 object-cover dark:block md:h-28 md:w-28"
              />
            </>
          ) : siteConfig.socials.github?.username ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`https://github.com/${siteConfig.socials.github.username}.png`}
              alt={siteConfig.identity.name}
              className="h-20 w-20 shrink-0 rounded-full border border-border object-cover md:h-28 md:w-28"
            />
          ) : null}
        </div>
      </motion.div>

      <div className="space-y-8">
        <motion.div {...fadeUp(0.15)}>
          <h5 className="mb-4 font-doto text-2xl font-medium md:text-3xl">
            About Me
          </h5>
          <p className="text-xs font-space-mono md:text-base md:leading-relaxed text-muted-foreground whitespace-pre-wrap">
            {siteConfig.identity.bio}
          </p>

        </motion.div>

        <motion.div {...fadeUp(0.25)}>
          <p className="mb-3 text-xs text-muted-foreground md:text-sm">
            My{" "}
            <span className="font-semibold text-foreground">social links</span>{" "}
            if you wish to connect with me
          </p>
          <div className="flex flex-wrap gap-2 p-1">
            {socialLinks.map(({ label, href, icon, external, platform, username, copyText }: any) => (
              <SocialButton
                key={label}
                label={label}
                href={href}
                icon={icon}
                external={external}
                platform={platform}
                username={username}
                copyText={copyText}
                data={socialData?.[platform]}
                loading={socialsLoading}
              />
            ))}
          </div>
        </motion.div>

        {children && (
          <motion.div {...fadeUp(0.35)}>
            {children}
          </motion.div>
        )}

        <motion.div {...fadeUp(0.45)}>
          <h5 className="mb-4 font-doto text-2xl font-medium md:text-3xl">
            Let&apos;s connect
          </h5>
          <p className="mb-4 font-space-mono text-xs leading-relaxed text-muted-foreground md:text-sm">
            Interested in working together? Feel free to schedule a meet!
          </p>
          <div className="flex flex-wrap gap-2 p-1">
            {connectLinks.map(({ label, href, icon, endIcon, external, copyText }: any) => (
              <SocialButton
                key={label}
                label={label}
                href={href}
                icon={icon}
                endIcon={endIcon}
                external={external}
                copyText={copyText}
              />
            ))}
          </div>
        </motion.div>
      </div>

    </div>
  );
};

export default Hero;

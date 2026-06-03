"use client";

import { useEffect, useState } from "react";

import { useViews } from "@portfolio/components/blog/views-context";
import BoltIcon from "@portfolio/components/icons/bolt";
import CloudSunIcon from "@portfolio/components/icons/cloud-sun";
import LocationIcon from "@portfolio/components/icons/location";
import IconTelescopeTripod from "@portfolio/components/icons/telescope-tripod";
import { usePortfolioConfig } from "@portfolio/components/portfolio-config-context";
import SeikoWatchModal from "@portfolio/components/watch-modal";

const SITE_VISITORS_SLUG = "_site_visitors";

const Footer = () => {
  const siteConfig = usePortfolioConfig();
  const [time, setTime] = useState<Date | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [weather, setWeather] = useState<string | null>(null);
  const { getViews, incrementViews } = useViews();
  const visitorCount = getViews(SITE_VISITORS_SLUG);

  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setTime(null);
      return;
    }

    let intervalId: NodeJS.Timeout | null = null;

    const startInterval = () => {
      if (!intervalId) {
        setTime(new Date());
        intervalId = setInterval(() => {
          setTime(new Date());
        }, 1000);
      }
    };

    const stopInterval = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        startInterval();
      } else {
        stopInterval();
      }
    };

    if (document.visibilityState === "visible") {
      startInterval();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stopInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [reducedMotion]);

  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<any> };
    let battObj: any = null;
    let updateFn: (() => void) | null = null;

    if (nav.getBattery) {
      nav.getBattery().then((batt: any) => {
        battObj = batt;
        updateFn = () => setBattery(Math.round(batt.level * 100));
        updateFn();
        batt.addEventListener("levelchange", updateFn);
      });
    }

    return () => {
      if (battObj && updateFn) {
        battObj.removeEventListener("levelchange", updateFn);
      }
    };
  }, []);

  useEffect(() => {
    incrementViews(SITE_VISITORS_SLUG);
  }, [incrementViews]);

  useEffect(() => {
    fetch("/api/location")
      .then((res) => res.json())
      .then((data) => {
        const city = data.city || "";
        const country = data.country || "";
        if (city && country) {
          setLocation(`${city}, ${country}`);
        } else {
          setLocation(city || country || null);
        }
        if (data.weather) {
          setWeather(`${data.weather.temperature}${data.weather.unit}`);
        }
      })
      .catch(() => setLocation(null));
  }, []);

  const formattedDate = time
    ? time.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "";

  const formattedTime = time
    ? time.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "";

  return (
    <footer className="mx-auto mb-24 w-full max-w-4xl px-6 md:mb-6 md:px-0">
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1 font-cera text-xs text-muted-foreground/60">
          {time && (
            <SeikoWatchModal>
              <button
                type="button"
                className="w-fit cursor-pointer text-left transition-colors hover:text-foreground focus:outline-hidden focus-visible:text-foreground"
                aria-label="Open Seiko analog watch"
              >
                {formattedDate} &middot; {formattedTime}
              </button>
            </SeikoWatchModal>
          )}
          {location && (
            <span className="flex items-center gap-1">
              <LocationIcon className="h-3 w-3" />
              {location}
              {weather && (
                <>
                  <span>&middot;</span>
                  <CloudSunIcon className="h-3 w-3" />
                  {weather}
                </>
              )}
            </span>
          )}
          {(battery !== null || visitorCount !== null) && (
            <span className="flex items-center gap-3">
              {visitorCount !== null && (
                <span className="flex items-center gap-1">
                  <IconTelescopeTripod className="h-3 w-3" />
                  {visitorCount.toLocaleString()} visitors
                </span>
              )}
              {battery !== null && (
                <span className="flex items-center gap-1">
                  <BoltIcon className="h-3 w-3" />
                  {battery}%
                </span>
              )}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground/60">
          &copy; {new Date().getFullYear()} {siteConfig.identity.name}. All rights
          reserved.
        </p>
      </div>
    </footer>
  );
};

export default Footer;

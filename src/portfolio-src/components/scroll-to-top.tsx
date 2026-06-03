"use client";

import React, { useState, useEffect } from "react";

import { motion, AnimatePresence } from "motion/react";

import { useChatPanel } from "@portfolio/components/chat-panel-context";
import { Button } from "@portfolio/components/ui/button";
import { CornerBrackets } from "@portfolio/components/ui/corner-brackets";
import { useMediaQuery } from "@portfolio/hooks/use-media-query";

export const ScrollToTopButton = () => {
  const [isVisible, setIsVisible] = useState(false);
  const { isOpen } = useChatPanel();
  const isDesktop = useMediaQuery("(min-width: 768px)");
  const shouldShift = isOpen && isDesktop;

  useEffect(() => {
    let ticking = false;

    const toggleVisibility = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setIsVisible(window.scrollY > 300);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", toggleVisibility, { passive: true });
    return () => window.removeEventListener("scroll", toggleVisibility);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 20, right: "40px" }}
          animate={{
            opacity: 1,
            y: 0,
            right: shouldShift ? "440px" : "40px",
          }}
          exit={{ opacity: 0, y: 20 }}
          transition={{
            right: { type: "spring", stiffness: 300, damping: 30 },
            opacity: { duration: 0.2 },
            y: { duration: 0.2 }
          }}
          className="hidden md:block fixed bottom-10 z-50"
        >
          <CornerBrackets>
            <Button
              size="icon"
              variant="outline"
              className="rounded-none bg-background/80 backdrop-blur-md"
              onClick={scrollToTop}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </Button>
          </CornerBrackets>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

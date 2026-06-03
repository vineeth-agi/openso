// @ts-nocheck
"use client";
import { useEffect, useRef } from "react";

const SPRITE_SETS = {
  idle: [[-3, -3]],
  alert: [[-7, -3]],
  scratchSelf: [[-5, 0], [-6, 0], [-7, 0]],
  scratchWallN: [[0, 0], [0, -1]],
  scratchWallS: [[-7, -1], [-6, -2]],
  scratchWallE: [[-2, -2], [-2, -3]],
  scratchWallW: [[-4, 0], [-4, -1]],
  tired: [[-3, -2]],
  sleeping: [[-2, 0], [-2, -1]],
  N: [[-1, -2], [-1, -3]],
  NE: [[0, -2], [0, -3]],
  E: [[-3, 0], [-3, -1]],
  SE: [[-5, -1], [-5, -2]],
  S: [[-6, -3], [-7, -2]],
  SW: [[-5, -3], [-6, -1]],
  W: [[-4, -2], [-4, -3]],
  NW: [[-1, 0], [-1, -1]],
};

const NEKO_SPEED = 15;

export default function OnekoCat() {
  const nekoRef = useRef<HTMLDivElement>(null);
  const nekoPosRef = useRef({ x: 32, y: 32 });
  const mousePosRef = useRef({ x: 0, y: 0 });
  const frameCountRef = useRef(0);
  const idleTimeRef = useRef(0);
  const idleAnimationRef = useRef<string | null>(null);
  const idleAnimationFrameRef = useRef(0);
  const lastFrameTimestamp = useRef<number | null>(null);
  const animationFrameId = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !nekoRef.current) return;

    // Check for reduced motion preference
    const isReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (isReducedMotion) {
      // Hide completely if reduced motion is preferred
      nekoRef.current.style.display = "none";
      return;
    }

    const nekoEl = nekoRef.current;

    // Set initial position based on viewport
    const isMobile = window.innerWidth <= 768;
    const initialX = isMobile ? window.innerWidth - 64 : 32;
    const initialY = 32;
    nekoPosRef.current = { x: initialX, y: initialY };
    nekoEl.style.left = `${initialX - 16}px`;
    nekoEl.style.top = `${initialY - 16}px`;

    const setSprite = (name: keyof typeof SPRITE_SETS, frame: number) => {
      const sprite = SPRITE_SETS[name][frame % SPRITE_SETS[name].length];
      if (sprite) {
        nekoEl.style.backgroundPosition = `${sprite[0] * 32}px ${sprite[1] * 32}px`;
      }
    };

    const resetIdleAnimation = () => {
      idleAnimationRef.current = null;
      idleAnimationFrameRef.current = 0;
    };

    const handleIdleLocal = () => {
      idleTimeRef.current += 1;

      if (idleTimeRef.current > 10 && Math.floor(Math.random() * 200) === 0 && !idleAnimationRef.current) {
        const availableIdleAnimations = ["sleeping", "scratchSelf"];
        if (nekoPosRef.current.x < 32) availableIdleAnimations.push("scratchWallW");
        if (nekoPosRef.current.y < 32) availableIdleAnimations.push("scratchWallN");
        if (nekoPosRef.current.x > window.innerWidth - 32) availableIdleAnimations.push("scratchWallE");
        if (nekoPosRef.current.y > window.innerHeight - 32) availableIdleAnimations.push("scratchWallS");

        idleAnimationRef.current = availableIdleAnimations[Math.floor(Math.random() * availableIdleAnimations.length)];
      }

      switch (idleAnimationRef.current) {
        case "sleeping":
          if (idleAnimationFrameRef.current < 8) {
            setSprite("tired", 0);
            break;
          }
          setSprite("sleeping", Math.floor(idleAnimationFrameRef.current / 4));
          if (idleAnimationFrameRef.current > 192) resetIdleAnimation();
          break;
        case "scratchWallN":
        case "scratchWallS":
        case "scratchWallE":
        case "scratchWallW":
        case "scratchSelf":
          setSprite(idleAnimationRef.current as any, idleAnimationFrameRef.current);
          if (idleAnimationFrameRef.current > 9) resetIdleAnimation();
          break;
        default:
          setSprite("idle", 0);
          return;
      }
      idleAnimationFrameRef.current += 1;
    };

    const handleFrameLocal = () => {
      frameCountRef.current += 1;
      const diffX = nekoPosRef.current.x - mousePosRef.current.x;
      const diffY = nekoPosRef.current.y - mousePosRef.current.y;
      const distance = Math.sqrt(diffX ** 2 + diffY ** 2);

      if (distance < NEKO_SPEED || distance < 48) {
        handleIdleLocal();
        return;
      }

      idleAnimationRef.current = null;
      idleAnimationFrameRef.current = 0;

      if (idleTimeRef.current > 1) {
        setSprite("alert", 0);
        idleTimeRef.current = Math.max(idleTimeRef.current - 1, 0);
        return;
      }

      let direction = "";
      direction += diffY / distance > 0.5 ? "N" : "";
      direction += diffY / distance < -0.5 ? "S" : "";
      direction += diffX / distance > 0.5 ? "W" : "";
      direction += diffX / distance < -0.5 ? "E" : "";
      setSprite(direction as any, frameCountRef.current);

      const newX = nekoPosRef.current.x - (diffX / distance) * NEKO_SPEED;
      const newY = nekoPosRef.current.y - (diffY / distance) * NEKO_SPEED;

      nekoPosRef.current = {
        x: Math.min(Math.max(16, newX), window.innerWidth - 16),
        y: Math.min(Math.max(16, newY), window.innerHeight - 16),
      };

      nekoEl.style.left = `${nekoPosRef.current.x - 16}px`;
      nekoEl.style.top = `${nekoPosRef.current.y - 16}px`;
    };

    const animate = (timestamp: number) => {
      if (document.visibilityState !== "visible") {
        animationFrameId.current = null;
        return;
      }

      if (!lastFrameTimestamp.current) {
        lastFrameTimestamp.current = timestamp;
      }

      if (timestamp - lastFrameTimestamp.current > 100) {
        lastFrameTimestamp.current = timestamp;
        handleFrameLocal();
      }

      animationFrameId.current = requestAnimationFrame(animate);
    };

    const handleMouseMove = (event: MouseEvent) => {
      mousePosRef.current = { x: event.clientX, y: event.clientY };
    };

    const handleResize = () => {
      nekoPosRef.current = {
        x: Math.min(Math.max(16, nekoPosRef.current.x), window.innerWidth - 16),
        y: Math.min(Math.max(16, nekoPosRef.current.y), window.innerHeight - 16),
      };
      nekoEl.style.left = `${nekoPosRef.current.x - 16}px`;
      nekoEl.style.top = `${nekoPosRef.current.y - 16}px`;
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (!animationFrameId.current) {
          lastFrameTimestamp.current = null;
          animationFrameId.current = requestAnimationFrame(animate);
        }
      } else {
        if (animationFrameId.current) {
          cancelAnimationFrame(animationFrameId.current);
          animationFrameId.current = null;
        }
      }
    };

    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (document.visibilityState === "visible") {
      animationFrameId.current = requestAnimationFrame(animate);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, []);

  return (
    <div
      ref={nekoRef}
      data-oneko-cat="true"
      aria-hidden="true"
      style={{
        width: "32px",
        height: "32px",
        position: "fixed",
        pointerEvents: "none",
        imageRendering: "pixelated",
        left: "32px",
        top: "32px",
        zIndex: 2147483647,
        backgroundImage: "url(/oneko.gif)",
      }}
    />
  );
}
"use client";

import type { ElementType, ReactNode } from "react";
import { memo } from "react";

import { cn } from "@/lib/utils";

export interface TextShimmerProps {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
}

const ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
}: TextShimmerProps) => {
  return (
    <Component
      className={cn(
        "inline-block bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-[length:200%_100%] bg-clip-text animate-text-shimmer",
        className
      )}
      style={{
        color: "transparent",
        WebkitTextFillColor: "transparent",
        WebkitBackgroundClip: "text",
      }}
    >
      {children}
    </Component>
  );
};

export const Shimmer = memo(ShimmerComponent);

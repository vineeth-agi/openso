import * as React from "react";

import { cn } from "@/lib/utils";

export type LuxeBadgeVariant =
  | "default"
  | "outline"
  | "success"
  | "destructive";

interface LuxeBadgeProps extends React.ComponentProps<"span"> {
  variant?: LuxeBadgeVariant;
}

export function LuxeBadge({
  variant = "default",
  className,
  ...props
}: LuxeBadgeProps) {
  const variants: Record<LuxeBadgeVariant, string> = {
    default: cn(
      "rounded-full border border-transparent bg-muted px-2.5 py-0.5 text-foreground shadow-inner",
      "shadow-foreground/20 hover:bg-accent"
    ),
    outline: cn(
      "rounded-full border border-border bg-transparent px-2.5 py-0.5",
      "text-muted-foreground hover:bg-muted/50"
    ),
    success: cn(
      "rounded-full border border-transparent bg-gradient-to-t from-green-700 to-green-600 px-2.5 py-0.5 text-white"
    ),
    destructive: cn(
      "rounded-full border border-transparent bg-gradient-to-t from-red-600 to-red-500 px-2.5 py-0.5 text-white"
    ),
  };

  return (
    <span
      className={cn(
        "inline-flex items-center text-xs font-medium whitespace-nowrap transition-all duration-200",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

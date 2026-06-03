"use client";
import { useEffect, useState } from "react";

import { useTheme } from "next-themes";
import NextTopLoader from "nextjs-toploader";

export default function TopLoader({ height = 2 }) {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  const color = resolvedTheme === "light" ? "#09090b" : "#ffffff";

  return <NextTopLoader color={color} height={height} showSpinner={false} />;
}

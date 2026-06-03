"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

// ─── svgl CDN icon mapping (https://github.com/pheralb/svgl) ───
const SVGL_ICONS: Record<string, string> = {
  typescript: "https://svgl.app/library/typescript.svg",
  ts: "https://svgl.app/library/typescript.svg",
  tsx: "https://svgl.app/library/typescript.svg",
  javascript: "https://svgl.app/library/javascript.svg",
  js: "https://svgl.app/library/javascript.svg",
  jsx: "https://svgl.app/library/javascript.svg",
  python: "https://svgl.app/library/python.svg",
  py: "https://svgl.app/library/python.svg",
  java: "https://svgl.app/library/java.svg",
  css: "https://svgl.app/library/css.svg",
  html: "https://svgl.app/library/html5.svg",
  go: "https://svgl.app/library/go.svg",
  golang: "https://svgl.app/library/go.svg",
  rust: "https://svgl.app/library/rust_dark.svg",
  ruby: "https://svgl.app/library/ruby.svg",
  php: "https://svgl.app/library/php_dark.svg",
  swift: "https://svgl.app/library/swift.svg",
  kotlin: "https://svgl.app/library/kotlin.svg",
  dart: "https://svgl.app/library/dart.svg",
  scala: "https://svgl.app/library/scala.svg",
  c: "https://svgl.app/library/c.svg",
  "c++": "https://svgl.app/library/c-plusplus.svg",
  cpp: "https://svgl.app/library/c-plusplus.svg",
  "c#": "https://svgl.app/library/csharp.svg",
  csharp: "https://svgl.app/library/csharp.svg",
  bash: "https://svgl.app/library/bash_dark.svg",
  shell: "https://svgl.app/library/bash_dark.svg",
  r: "https://svgl.app/library/r_dark.svg",
  lua: "https://svgl.app/library/lua.svg",
  haskell: "https://svgl.app/library/haskell.svg",
  perl: "https://svgl.app/library/perl.svg",
  powershell: "https://svgl.app/library/powershell.svg",
  dockerfile: "https://svgl.app/library/docker.svg",
  docker: "https://svgl.app/library/docker.svg",
  postgresql: "https://svgl.app/library/postgresql.svg",
  plpgsql: "https://svgl.app/library/postgresql.svg",
  sql: "https://svgl.app/library/postgresql.svg",
  sass: "https://svgl.app/library/sass.svg",
  scss: "https://svgl.app/library/sass.svg",
  json: "https://svgl.app/library/json.svg",
  markdown: "https://svgl.app/library/markdown-dark.svg",
  zig: "https://svgl.app/library/zig.svg",
  julia: "https://svgl.app/library/julia.svg",
  solidity: "https://svgl.app/library/solidity.svg",
  fortran: "https://svgl.app/library/fortran.svg",
  svelte: "https://svgl.app/library/svelte.svg",
  vue: "https://svgl.app/library/vue.svg",
  elixir: "https://svgl.app/library/elixir.svg",
  erlang: "https://svgl.app/library/erlang.svg",
  clojure: "https://svgl.app/library/clojure.svg",
};

// ─── GitHub linguist-style language colors (fallback) ───
const LANG_COLORS: Record<string, string> = {
  typescript: "#3178C6",
  javascript: "#F7DF1E",
  python: "#3572A5",
  java: "#B07219",
  css: "#563D7C",
  html: "#E34C26",
  go: "#00ADD8",
  rust: "#DEA584",
  ruby: "#CC342D",
  php: "#4F5D95",
  swift: "#F05138",
  kotlin: "#A97BFF",
  dart: "#00B4AB",
  scala: "#DC322F",
  c: "#555555",
  "c++": "#F34B7D",
  cpp: "#F34B7D",
  "c#": "#178600",
  csharp: "#178600",
  bash: "#89E051",
  shell: "#89E051",
  r: "#198CE7",
  lua: "#000080",
  haskell: "#5E5086",
  perl: "#0298C3",
  powershell: "#012456",
  dockerfile: "#384D54",
  docker: "#2496ED",
  postgresql: "#336791",
  plpgsql: "#336791",
  sql: "#E38C00",
  sass: "#CF649A",
  scss: "#CF649A",
  makefile: "#427819",
  vue: "#41B883",
  svelte: "#FF3E00",
  batchfile: "#C1F12E",
  objective_c: "#438EFF",
  elixir: "#6E4A7E",
  erlang: "#B83998",
  clojure: "#DB5855",
  jupyter: "#F37626",
  "jupyter notebook": "#F37626",
};

interface LanguageIconProps {
  language: string;
  size?: number;
  className?: string;
}

export function LanguageIcon({ language, size = 16, className }: LanguageIconProps) {
  const [imgError, setImgError] = useState(false);
  const key = language.toLowerCase().trim();
  const svgUrl = SVGL_ICONS[key];
  const color = LANG_COLORS[key] || "#6B7280";

  if (svgUrl && !imgError) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={svgUrl}
        alt={language}
        width={size}
        height={size}
        className={cn("inline-block shrink-0", className)}
        onError={() => setImgError(true)}
        loading="lazy"
      />
    );
  }

  // Fallback: colored dot (GitHub linguist style)
  return (
    <span
      className={cn("inline-block shrink-0 rounded-full", className)}
      style={{
        width: size * 0.65,
        height: size * 0.65,
        backgroundColor: color,
      }}
    />
  );
}

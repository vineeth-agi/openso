"use client";

import React, { memo, useState } from "react";

import { Check, Copy } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CodeBlock as PremiumCodeBlock } from "@/components/ai/code-block";

// Code block with copy button
function CodeBlock({
  inline,
  className,
  children,
  ...props
}: {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  const [copied, setCopied] = useState(false);

  const codeString = String(children).replace(/\n$/, "");
  const match = /language-(\w+)/.exec(className || "");
  const language = match?.[1] || "";

  if (inline) {
    return (
      <code
        className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]"
        {...props}
      >
        {children}
      </code>
    );
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(codeString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="group/code relative my-4 overflow-hidden rounded-lg border border-border bg-background">
      {language && (
        <div className="flex items-center justify-between border-b border-border/40 bg-muted/40 px-4 py-1.5">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground/60">{language}</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
        </div>
      )}
      <div className="relative text-sm [&_pre]:!bg-transparent [&_pre]:!p-4 overflow-hidden">
        <PremiumCodeBlock code={codeString} language={(language as any) || "text"} />
      </div>
    </div>
  );
}

const components: Components = {
  code: ({ className, children, ...props }) => {
    // Check if this is inline code (no newlines, not inside a pre)
    const isInline =
      typeof children === "string" && !children.includes("\n");

    if (isInline) {
      return (
        <code
          className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em]"
          {...props}
        >
          {children}
        </code>
      );
    }

    return (
      <CodeBlock className={className} {...props}>
        {children}
      </CodeBlock>
    );
  },
  pre: ({ children }) => <>{children}</>,
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-7">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 ml-6 list-disc space-y-1.5 [&>li]:leading-relaxed">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 ml-6 list-decimal space-y-1.5 [&>li]:leading-relaxed">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-muted-foreground/30 pl-4 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
  h1: ({ children }) => <h1 className="mb-3 mt-6 text-2xl font-bold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-5 text-xl font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-4 text-lg font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h4>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary underline decoration-primary/30 underline-offset-4 transition-colors hover:decoration-primary"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b bg-muted/50">{children}</thead>,
  th: ({ children }) => <th className="px-4 py-2 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-t px-4 py-2">{children}</td>,
  hr: () => <hr className="my-4 border-border" />,
};

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="max-w-none text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownContent);

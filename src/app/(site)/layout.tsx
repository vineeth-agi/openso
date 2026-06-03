import { Inter } from "next/font/google";
import localFont from "next/font/local";

import type { Metadata } from "next";
import { Toaster } from "sonner";

import { ThemeProvider } from "@/components/theme-provider";
import { getAppUrlOrLocalhost } from "@/lib/app-url";
import "@/styles/globals.css";

function resolveMetadataBase(): URL {
  const rawUrl = getAppUrlOrLocalhost();
  try {
    return new URL(rawUrl);
  } catch {
    return new URL("http://localhost:3000");
  }
}

const dmSans = localFont({
  src: [
    {
      path: "../../../fonts/dm-sans/DMSans-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../../fonts/dm-sans/DMSans-Medium.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../../fonts/dm-sans/DMSans-SemiBold.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../../fonts/dm-sans/DMSans-Bold.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-dm-sans",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: {
    default: "Openso | Your open-source career on autopilot",
    template: "%s | Openso",
  },
  description:
    "Openso helps developers find real open-source issues, build AI-powered portfolios with a recruiter chatbot, land jobs, and chat with any GitHub repo.",
  keywords: [
    "open source",
    "open source contributions",
    "good first issues",
    "developer portfolio",
    "AI portfolio",
    "recruiter chatbot",
    "chat with repo",
    "github jobs",
    "developer jobs",
    "code search",
    "github indexing",
    "AI for developers",
  ],
  authors: [{ name: "Openso" }],
  creator: "Openso",
  publisher: "Openso",
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/openso_logo.png", type: "image/png" }
    ],
    apple: [{ url: "/openso_logo.png", type: "image/png" }],
    shortcut: [{ url: "/openso_logo.png" }],
  },
  // NOTE: `images` is intentionally omitted here. The Open Graph image is
  // generated at request time by `src/app/opengraph-image.tsx` (and the
  // matching `twitter-image.tsx`) using the Next.js metadata file
  // convention. Adding `images` back to this object will override the file
  // convention and re-introduce the stale-preview bug.
  openGraph: {
    title: "Openso | Your open-source career on autopilot",
    description:
      "Find real open-source issues, build an AI-powered portfolio, land jobs, and chat with any GitHub repo.",
    siteName: "Openso",
  },
  twitter: {
    card: "summary_large_image",
    title: "Openso | Your open-source career on autopilot",
    description:
      "Find real open-source issues, build an AI-powered portfolio, land jobs, and chat with any GitHub repo.",
    creator: "@vineeth_agi",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
      <html lang="en" suppressHydrationWarning>
        <head />
        <body className={`${dmSans.variable} ${inter.variable} antialiased`}>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            forcedTheme="dark"
            disableTransitionOnChange
          >
              <div className="">{children}</div>
              <Toaster richColors position="bottom-right" />
          </ThemeProvider>
        </body>
      </html>
  );
}

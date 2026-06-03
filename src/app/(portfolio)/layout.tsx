import "./portfolio-globals.css";

import { Space_Mono, Doto } from "next/font/google";

import { GeistPixelSquare } from "geist/font/pixel";
import type { Metadata } from "next";


import { ViewsProvider } from "@portfolio/components/blog/views-context";
import { ChatAwareContent } from "@portfolio/components/chat-aware-content";
import { ChatPanelProvider } from "@portfolio/components/chat-panel-context";
import OnekoCat from "@portfolio/components/OnekoCat";
import { PortfolioConfigStoreProvider } from "@portfolio/components/portfolio-config-context";
import { ScrollToTopButton } from "@portfolio/components/scroll-to-top";
import Footer from "@portfolio/components/sections/footer";
import NavigationBar from "@portfolio/components/sections/navigation";
import { SmoothScrollProvider } from "@portfolio/components/smooth-scroll-provider";
import { ThemeProvider } from "@portfolio/components/theme-provider";
import TopLoader from "@portfolio/components/top-loader";
import { Toaster } from "@portfolio/components/ui/toaster";

import { getAppUrlOrLocalhost } from "@/lib/app-url";




const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
});


const doto = Doto({
  subsets: ["latin"],
  variable: "--font-doto",
  display: "swap",
});

function resolveMetadataBase(): URL {
  const rawUrl = getAppUrlOrLocalhost();
  try {
    return new URL(rawUrl);
  } catch {
    return new URL("http://localhost:3000");
  }
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: "Portfolio",
  description: "Personal Portfolio",
  icons: {
    icon: [{ url: "/openso_logo.png", type: "image/png" }],
    apple: [{ url: "/openso_logo.png", type: "image/png" }],
    shortcut: [{ url: "/openso_logo.png" }],
  },
};

export default function PortfolioRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceMono.variable} ${doto.variable}`}
    >
      <head>
        <meta name="theme-color" content="#000000" />
        <meta name="color-scheme" content="dark light" />
      </head>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <PortfolioConfigStoreProvider>
            <ChatPanelProvider>
              <TopLoader />
              <SmoothScrollProvider>
                <ViewsProvider>
                  <ChatAwareContent className="grid min-h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto] overflow-x-hidden">
                    <main
                      className={`${GeistPixelSquare.className} max-w-[1800px] px-6 pt-14 sm:pt-24 md:mx-auto md:px-0`}
                    >
                      <OnekoCat />
                      {children}
                    </main>
                    <Footer />
                    <NavigationBar />
                    <Toaster />
                    <ScrollToTopButton />
                  </ChatAwareContent>
                </ViewsProvider>
              </SmoothScrollProvider>
            </ChatPanelProvider>
          </PortfolioConfigStoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

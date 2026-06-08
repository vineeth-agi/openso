import Link from "next/link";

import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LogoCloud } from "@/components/ui/logo-cloud";
import { cn } from "@/lib/utils";

export function HeroSection() {
	return (
		<section className="mx-auto w-full max-w-5xl px-4 md:px-0">
			{/* main content */}

			<div className="relative flex flex-col items-center justify-center gap-5 pt-32 pb-30">
				
				<div className="flex flex-col sm:flex-row items-center gap-3 z-10">
					<a
						href="https://insforge.dev"
						target="_blank"
						rel="noopener noreferrer"
						className={cn(
							"group flex w-fit items-center gap-2.5 rounded-full border border-zinc-800 bg-zinc-950/85 hover:bg-zinc-900 px-3.5 py-1.5 shadow transition-all duration-300",
							"fade-in slide-in-from-bottom-10 animate-in fill-mode-backwards duration-500 ease-out"
						)}
					>
						<span className="text-[11px] text-zinc-400 font-medium group-hover:text-zinc-200 transition-colors">
							Sponsored by
						</span>
						<span className="h-3 w-px bg-zinc-850" />
						<img
							src="/sponsors/insforge-logo.svg"
							alt="InsForge"
							className="h-4 w-auto opacity-80 group-hover:opacity-100 transition-all duration-300"
						/>
					</a>
				</div>

				<h1
					className={cn(
						"fade-in slide-in-from-bottom-10 animate-in text-balance fill-mode-backwards text-center text-3xl tracking-tight delay-100 duration-500 ease-out md:text-4xl lg:text-6xl",
						"text-shadow-[0_0px_50px_rgb(148_163_184/.2)]"
					)}
				>
					The everything platform <br /> for open-source devs
				</h1>

				<p className="fade-in slide-in-from-bottom-10 mx-auto max-w-2xl animate-in fill-mode-backwards text-center text-base text-foreground/80 tracking-wider delay-200 duration-500 ease-out sm:text-lg md:text-xl">
					Find perfect-fit open source issues and build stunning developer portfolios with automated AI workflows.
				</p>

				<div className="fade-in slide-in-from-bottom-10 flex animate-in flex-row flex-wrap items-center justify-center gap-3 fill-mode-backwards pt-2 delay-300 duration-500 ease-out">
					<Button className="rounded-full" size="lg" variant="secondary" asChild>
						<Link href="/open-source-issues">Search Issues</Link>
					</Button>
				</div>
			</div>
		</section>
	);
}

export function LogosSection() {
	return (
		<section className="relative space-y-4 border-t px-4 pt-6 pb-10 md:px-0">
			<h2 className="text-center font-medium text-2xl text-muted-foreground tracking-tight lg:text-xl">
				Trusted by <span className="text-foreground">experts</span>
			</h2>
			<div className="relative z-10 mx-auto max-w-4xl">
				<LogoCloud />
			</div>
		</section>
	);
}

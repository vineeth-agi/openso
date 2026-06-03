import Image from "next/image";
import Link from "next/link";

import { GithubIcon } from "lucide-react";

import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

const socialLinks = [
	{
		href: "https://x.com/zerolatency_",
		label: "X",
		icon: <XIcon />,
	},
];

const legalLinks = [
	{ href: "/terms", label: "Terms of Service" },
	{ href: "/privacy", label: "Privacy Policy" },
] as const;

export function Footer() {
	return (
		<footer className="mx-auto max-w-5xl *:px-4 *:md:px-6">
			<div className="flex flex-col gap-6 py-6">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Logo className="h-8" />
					</div>
					<div className="flex items-center">
						{socialLinks.map(({ href, label, icon }) => (
							<Button asChild key={label} size="icon-sm" variant="ghost">
								<a aria-label={label} href={href} target="_blank" rel="noopener noreferrer">
									{icon}
								</a>
							</Button>
						))}
					</div>
				</div>
			</div>

			<nav
				aria-label="Legal"
				className="flex flex-col gap-2 border-t py-4 text-sm md:flex-row md:items-center md:justify-between"
			>
				<span className="font-medium text-foreground/80">Legal</span>
				<ul className="flex flex-wrap items-center gap-x-6 gap-y-2 text-muted-foreground">
					{legalLinks.map((l) => (
						<li key={l.href}>
							<Link
								className="hover:text-foreground hover:underline"
								href={l.href}
							>
								{l.label}
							</Link>
						</li>
					))}
				</ul>
			</nav>

			<div className="flex flex-col gap-4 border-t py-4 text-muted-foreground text-sm sm:flex-row sm:items-center sm:justify-between">
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1">
					<p>&copy; {new Date().getFullYear()} Openso. All rights reserved.</p>
					<span className="hidden sm:inline text-muted-foreground/30">•</span>
					<p>
						Portfolio template by{" "}
						<a
							className="text-foreground/80 hover:text-foreground hover:underline font-medium"
							href="https://github.com/buddhsen-tripathi/PortfolioWeb"
							target="_blank"
							rel="noopener noreferrer"
						>
							Buddhsen Tripathi
						</a>
					</p>
				</div>

				<p className="inline-flex items-center gap-1">
					<span>Built by</span>
					<a
						aria-label="X Profile"
						className="inline-flex items-center gap-1 text-foreground/80 hover:text-foreground hover:underline"
						href="https://x.com/zerolatency_"
						target="_blank"
						rel="noopener noreferrer"
					>
						<Image
							alt="Vineeth"
							className="size-4 max-w-full h-auto rounded-full object-cover"
							height={16}
							src="/profilepic.png"
							width={16}
						/>
						Vineeth
					</a>
				</p>
			</div>
		</footer>
	);
}

function XIcon(props: React.ComponentProps<"svg">) {
	return (
		<svg
			fill="currentColor"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
			{...props}
		>
			<path d="m18.9,1.153h3.682l-8.042,9.189,9.46,12.506h-7.405l-5.804-7.583-6.634,7.583H.469l8.6-9.831L0,1.153h7.593l5.241,6.931,6.065-6.931Zm-1.293,19.494h2.039L6.482,3.239h-2.19l13.314,17.408Z" />
		</svg>
	);
}

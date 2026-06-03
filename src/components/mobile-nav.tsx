import React from "react";

import Link from "next/link";

import { XIcon, MenuIcon } from "lucide-react";

import { navLinks } from "@/components/header";
import { Button } from "@/components/ui/button";
import { Portal, PortalBackdrop } from "@/components/ui/portal";
import { cn } from "@/lib/utils";

export function MobileNav() {
	const [open, setOpen] = React.useState(false);

	return (
		<div className="md:hidden">
			<Button
				aria-controls="mobile-menu"
				aria-expanded={open}
				aria-label="Toggle menu"
				className="md:hidden"
				onClick={() => setOpen(!open)}
				size="icon"
				variant="outline"
			>
				{open ? (
					<XIcon className="size-4.5" />
				) : (
					<MenuIcon className="size-4.5" />
				)}
			</Button>
			{open && (
				<Portal className="top-14" id="mobile-menu">
					<PortalBackdrop />
					<div
						className={cn(
							"data-[slot=open]:zoom-in-97 ease-out data-[slot=open]:animate-in",
							"size-full p-4"
						)}
						data-slot={open ? "open" : "closed"}
					>
						{navLinks.length > 0 && (
							<div className="grid gap-y-2">
								{navLinks.map((link) => (
									<Button
										asChild
										className="justify-start"
										key={link.label}
										variant="ghost"
									>
										<a href={link.href}>{link.label}</a>
									</Button>
								))}
							</div>
						)}
						<div className="mt-12 flex flex-col gap-2">
							<Button className="w-full" asChild>
								<Link href="/signin">Get Started</Link>
							</Button>
						</div>
					</div>
				</Portal>
			)}
		</div>
	);
}

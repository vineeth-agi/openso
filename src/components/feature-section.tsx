import type React from "react";

import { SearchIcon, GitBranchIcon, LayoutDashboardIcon, LinkIcon, SparklesIcon } from "lucide-react";

import { DecorIcon } from "@/components/ui/decor-icon";
import { cn } from "@/lib/utils";

type FeatureType = {
	title: string;
	icon: React.ReactNode;
	description: string;
	comingSoon?: boolean;
};

export function FeatureSection() {
	return (
		<div className="mx-auto max-w-5xl px-4 md:px-0">
			<h2 className="mb-5 text-center font-medium text-2xl md:text-3xl">
				The Features
			</h2>

			<div className="relative overflow-hidden">
				{/* Corner Icons */}
				<DecorIcon
					className="size-6 stroke-2 stroke-border"
					position="top-left"
				/>
				<DecorIcon
					className="size-6 stroke-2 stroke-border"
					position="top-right"
				/>
				<DecorIcon
					className="size-6 stroke-2 stroke-border"
					position="bottom-left"
				/>
				<DecorIcon
					className="size-6 stroke-2 stroke-border"
					position="bottom-right"
				/>

				<DashedLine className="-top-[1.5px] right-3 left-3" />
				<DashedLine className="top-3 -right-[1.5px] bottom-3" />
				<DashedLine className="top-3 bottom-3 -left-[1.5px]" />
				<DashedLine className="right-3 -bottom-[1.5px] left-3" />

				<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:gap-0 lg:grid-cols-3">
					{features.map((feature) => (
						<div
							className="group [&_svg]:mask-b-from-0% relative p-8 [&_svg]:size-7 [&_svg]:text-muted-foreground"
							key={feature.title}
						>
							{feature.icon}
							<div className="flex items-center gap-2">
								<h3 className="font-medium text-lg">{feature.title}</h3>
								{feature.comingSoon && (
									<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
										Coming Soon
									</span>
								)}
							</div>
							<p className="text-muted-foreground text-sm leading-relaxed">
								{feature.description}
							</p>
							<DashedLine className="right-5 bottom-0 left-5 group-last:hidden lg:top-5 lg:right-0 lg:bottom-5 lg:left-full" />
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

function DashedLine({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			className={cn("absolute border-collapse border border-dashed", className)}
			{...props}
		/>
	);
}

const features: FeatureType[] = [
	{
		title: "Open Source Issue Finder",
		icon: <SearchIcon />,
		description: "Find perfect open source issues based on your skills and interests with AI-powered matching.",
	},
	{
		title: "Portfolio Creation",
		icon: <LayoutDashboardIcon />,
		description: "Create a stunning developer portfolio that showcases your projects, skills, and contributions. Includes a built-in chat where recruiters can ask about your work and explore your public repos.",
	},
	{
		title: "Auto PR Generation",
		icon: <GitBranchIcon />,
		comingSoon: true,
		description: "Paste any issue and watch AI create, test, and submit pull requests automatically.",
	},
	{
		title: "Link Repo & Task",
		icon: <LinkIcon />,
		comingSoon: true,
		description: "Connect any repository and assign tasks, and our AI handles code changes, testing, and delivery.",
	},
	{
		title: "And Much More",
		icon: <SparklesIcon />,
		description: "We're constantly building new AI-powered tools to supercharge your developer workflow.",
	},
];

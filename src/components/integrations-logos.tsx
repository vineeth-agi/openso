import {
	UserIcon,
	SearchIcon,
	CodeIcon,
	BrainIcon,
	StarIcon,
	GitBranchIcon,
	FolderIcon,
	ZapIcon,
	TargetIcon,
} from "lucide-react";

import { IntegrationCard, type TileData } from "@/components/integration-card";
import { Button } from "@/components/ui/button";
import { FullWidthDivider } from "@/components/ui/full-width-divider";
import { cn } from "@/lib/utils";

export function Integrations3() {
	return (
		<div className="relative mx-auto mt-16 grid max-w-4xl grid-cols-1 gap-12 overflow-hidden border-x px-4 md:grid-cols-2 md:items-center md:px-0">
			<FullWidthDivider className="-top-px" />

			{/* Left Content */}
			<div className="p-4 md:p-6">
				<div className="space-y-4">
					<h2 className="font-medium text-2xl text-foreground tracking-tight sm:text-3xl lg:text-4xl">
						It Remembers Everything About You
					</h2>
					<p className="text-muted-foreground text-sm md:text-base">
						Our AI learns from your GitHub activity: your skills, contributions, coding patterns, and interests. It builds a living profile that evolves with you, so every recommendation gets smarter over time.
					</p>
					<Button size="sm">Connect GitHub</Button>
				</div>
			</div>

			{/* Right Content - Visual */}
			<div className="place-items-end">
				<div className="relative size-80 max-w-full">
					{/* Grid Background */}
					<div
						className={cn(
							"absolute inset-0 size-full",
							"bg-[linear-gradient(to_right,theme(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,theme(--color-border)_1px,transparent_1px)]",
							"bg-size-[64px_64px]",
							"mask-[radial-gradient(ellipse_at_center,black,black,transparent)]"
						)}
					/>

					{tiles.map((tile) => (
						<IntegrationCard
							key={`${tile.row}_${tile.col}`}
							{...tile}
							cellSize={64}
							cardClassName={cn(
								"size-16",
								tile.Icon || tile.logo ? "bg-secondary/40" : "",
							)}
							logoClassName="text-foreground"
						/>
					))}
				</div>
			</div>

			<FullWidthDivider className="-bottom-px" />
		</div>
	);
}

// Coordinate mapping to approximate the "scattered" look in the image.
// Grid 6x5 — now using topic-based icons instead of company logos.
const tiles: TileData[] = [
	// Row 0
	{ row: 0, col: 1, Icon: UserIcon, iconLabel: "Profile" },
	{ row: 0, col: 3, Icon: SearchIcon, iconLabel: "Search" },

	// Row 1
	{ row: 1, col: 0 }, // Empty
	{ row: 1, col: 2, Icon: CodeIcon, iconLabel: "Skills" },
	{ row: 1, col: 4, Icon: BrainIcon, iconLabel: "Memory" },

	// Row 2
	{ row: 2, col: 1, Icon: StarIcon, iconLabel: "Interests" },
	{ row: 2, col: 3 }, // Empty

	// Row 3
	{ row: 3, col: 0 }, // Empty
	{ row: 3, col: 2, Icon: GitBranchIcon, iconLabel: "Contributions" },
	{ row: 3, col: 4, Icon: FolderIcon, iconLabel: "Repos" },

	// Row 4
	{ row: 4, col: 1, Icon: ZapIcon, iconLabel: "Activity" },
	{ row: 4, col: 3, Icon: TargetIcon, iconLabel: "Matching" },
];

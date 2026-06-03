import {
	SiStripe,
	SiAirbnb,
	SiDropbox,
	SiReddit,
	SiCoinbase,
	SiDoordash,
	SiInstacart,
	SiTwitch,
} from "react-icons/si";

import { IntegrationCard, type TileData } from "@/components/integration-card";
import { cn } from "@/lib/utils";

export function Integrations4() {
	return (
		<div className="mx-auto mt-16 grid max-w-5xl grid-cols-1 gap-12 p-4 md:grid-cols-2 md:items-center">
			{/* Left Content */}
			<div className="max-w-xl space-y-5">
				<h2 className="font-medium text-2xl text-foreground tracking-tight sm:text-3xl md:text-4xl lg:text-5xl">
					Find Jobs Across YC Companies & Beyond
				</h2>
				<p className="text-lg text-muted-foreground leading-8">
					Discover opportunities at top Y Combinator startups and leading tech companies. Our AI matches your GitHub skills to the right roles across hundreds of companies hiring now.
				</p>
			</div>

			{/* Right Content - Visual */}
			<div className="place-items-end">
				<div className="mask-[radial-gradient(ellipse_at_center,black,black,transparent)] relative w-full max-w-90 aspect-square mx-auto overflow-hidden md:size-90 md:w-auto md:max-w-none md:mx-0">
					{tiles.map((tile) => (
						<IntegrationCard
							key={`${tile.row}_${tile.col}`}
							{...tile}
							cellSize={72}
							cardClassName={cn(
								"size-18 rounded-md border",
								tile.Icon || tile.logo
									? "bg-card shadow-xs dark:bg-card/60"
									: "bg-secondary/30 dark:bg-background"
							)}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

// Grid 5x5 — YC companies and top tech companies
const tiles: TileData[] = [
	// Row 0
	{
		row: 0,
		col: 1,
	},
	{
		row: 0,
		col: 3,
		Icon: SiStripe,
		iconLabel: "Stripe",
		iconColor: "#635BFF",
	},

	// Row 1
	{ row: 1, col: 0 }, // Empty
	{
		row: 1,
		col: 2,
		Icon: SiAirbnb,
		iconLabel: "Airbnb",
		iconColor: "#FF5A5F",
	},
	{
		row: 1,
		col: 4,
		Icon: SiDropbox,
		iconLabel: "Dropbox",
		iconColor: "#0061FF",
	},

	// Row 2
	{
		row: 2,
		col: 1,
		Icon: SiReddit,
		iconLabel: "Reddit",
		iconColor: "#FF4500",
	},
	{
		row: 2,
		col: 3,
		Icon: SiCoinbase,
		iconLabel: "Coinbase",
		iconColor: "#0052FF",
	},

	// Row 3
	{ row: 3, col: 0 }, // Empty
	{
		row: 3,
		col: 2,
		Icon: SiDoordash,
		iconLabel: "DoorDash",
		iconColor: "#FF3008",
	},
	{
		row: 3,
		col: 4,
		Icon: SiInstacart,
		iconLabel: "Instacart",
		iconColor: "#43B02A",
	},

	// Row 4
	{
		row: 4,
		col: 1,
		Icon: SiTwitch,
		iconLabel: "Twitch",
		iconColor: "#9146FF",
	},
	{
		row: 4,
		col: 3,
	},
];

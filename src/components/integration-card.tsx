import type { ComponentType, SVGProps } from "react";

import Image from "next/image";

import { cn } from "@/lib/utils";

export type LogoType = {
	src: string;
	alt: string;
	isInvertable?: boolean;
};

export type TileData = {
	row: number;
	col: number;
	logo?: LogoType;
	/** Optional inline icon component (e.g. from react-icons). Takes precedence over `logo`. */
	Icon?: ComponentType<SVGProps<SVGSVGElement>>;
	/** Accessible label when using `Icon`. */
	iconLabel?: string;
	/** Optional brand color for the icon (e.g. "#635BFF" for Stripe). */
	iconColor?: string;
};

interface IntegrationCardProps extends TileData {
	cellSize: number;
	/** Extra classes for the card container */
	cardClassName?: string;
	/** Extra classes for the logo image */
	logoClassName?: string;
}

export function IntegrationCard({
	row,
	col,
	logo,
	Icon,
	iconLabel,
	iconColor,
	cellSize,
	cardClassName,
	logoClassName,
}: IntegrationCardProps) {
	return (
		<div
			className={cn(
				"absolute flex items-center justify-center",
				cardClassName,
			)}
			style={{
				left: col * cellSize,
				top: row * cellSize,
			}}
		>
			{Icon ? (
				<Icon
					aria-label={iconLabel}
					role={iconLabel ? "img" : undefined}
					className={cn(
						"pointer-events-none size-8 select-none p-1",
						logoClassName,
					)}
					style={iconColor ? { color: iconColor } : undefined}
				/>
			) : logo ? (
				<Image
					alt={logo.alt}
					className={cn(
						"pointer-events-none size-8 max-w-full h-auto select-none object-contain p-1",
						logoClassName,
						logo.isInvertable && "dark:invert",
					)}
					height={40}
					loading="lazy"
					src={logo.src}
					width={40}
				/>
			) : null}
		</div>
	);
}

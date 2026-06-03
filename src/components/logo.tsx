import type React from "react";

import { cn } from "@/lib/utils";

export interface LogoProps extends Omit<React.ComponentProps<"img">, "src" | "alt"> {
	className?: string;
}

export const LogoIcon = ({ className, ...props }: LogoProps) => (
	<img
		src="/mainlogo.svg"
		alt="Openso Icon"
		className={cn("h-12 w-auto select-none", className)}
		{...props}
	/>
);

export const Logo = ({ className, ...props }: LogoProps) => (
	<img
		src="/mainlogo.svg"
		alt="Openso Logo"
		className={cn("h-8 w-auto select-none", className)}
		{...props}
	/>
);


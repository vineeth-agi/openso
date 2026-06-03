"use client";

import React from "react";

interface InfiniteSliderProps {
	children: React.ReactNode;
	gap?: number;
	reverse?: boolean;
	speed?: number;
	speedOnHover?: number;
	className?: string;
}

export function InfiniteSlider({
	children,
	gap = 24,
	reverse = false,
	speed = 50,
	speedOnHover = 0,
	className = "",
}: InfiniteSliderProps) {
	const [isHovered, setIsHovered] = React.useState(false);
	const [isMobile, setIsMobile] = React.useState(false);
	const currentSpeed = isHovered && speedOnHover > 0 ? speedOnHover : speed;

	// Detect mobile viewport to disable infinite animation
	React.useEffect(() => {
		const mql = window.matchMedia("(max-width: 767px)");
		setIsMobile(mql.matches);
		const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mql.addEventListener("change", handler);
		return () => mql.removeEventListener("change", handler);
	}, []);

	// Add CSS animation to document head
	React.useEffect(() => {
		const styleId = 'infinite-slider-style';
		if (!document.getElementById(styleId)) {
			const style = document.createElement('style');
			style.id = styleId;
			style.textContent = `
				@keyframes scroll {
					0% { transform: translateX(0); }
					100% { transform: translateX(-50%); }
				}
				.infinite-slider-track {
					display: flex;
					gap: var(--slider-gap, 24px);
					animation-name: scroll;
					animation-duration: var(--slider-speed, 50s);
					animation-timing-function: linear;
					animation-iteration-count: infinite;
					animation-direction: var(--slider-direction, normal);
				}
			`;
			document.head.appendChild(style);
		}
	}, []);

	// On mobile, render a static grid instead of the infinite scroll
	if (isMobile) {
		return (
			<div
				className={`relative overflow-hidden ${className}`}
			>
				<div
					className="flex flex-wrap items-center justify-center"
					style={{ gap: `${gap}px` }}
				>
					{children}
				</div>
			</div>
		);
	}

	return (
		<div
			className={`relative overflow-hidden ${className}`}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			<div
				className="infinite-slider-track"
				style={{
					"--slider-gap": `${gap}px`,
					"--slider-speed": `${currentSpeed}s`,
					"--slider-direction": reverse ? "reverse" : "normal",
				} as React.CSSProperties}
			>
				{children}
				{children} {/* Duplicate for seamless loop */}
			</div>
		</div>
	);
}

"use client";
import { useEffect, useState, useRef } from "react";

export function useScroll(downThreshold: number, upThreshold?: number) {
	const [scrolled, setScrolled] = useState(false);
	const scrolledRef = useRef(false);
	const scrollUpThreshold = upThreshold ?? downThreshold / 2;

	useEffect(() => {
		let ticking = false;

		const handleScroll = () => {
			if (!ticking) {
				window.requestAnimationFrame(() => {
					const y = window.scrollY;
					const nextScrolled = scrolledRef.current ? y > scrollUpThreshold : y > downThreshold;
					if (nextScrolled !== scrolledRef.current) {
						scrolledRef.current = nextScrolled;
						setScrolled(nextScrolled);
					}
					ticking = false;
				});
				ticking = true;
			}
		};

		window.addEventListener("scroll", handleScroll, { passive: true });
		handleScroll();
		return () => window.removeEventListener("scroll", handleScroll);
	}, [downThreshold, scrollUpThreshold]);

	return scrolled;
}

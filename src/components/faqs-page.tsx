"use client";

import { HelpCircle, Mail, Sparkles } from "lucide-react";

import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion";

export function FaqsSection() {
	return (
		<section className="mx-auto w-full max-w-5xl py-24 lg:border-x border-border/30 bg-background/30 backdrop-blur-sm">
			<div className="mx-4 grid grid-cols-1 border-x border-border/25 md:mx-0 md:grid-cols-12 md:border-x-0">
				{/* Left Sidebar Info Banner */}
				<div className="md:col-span-5 space-y-6 px-6 pb-8 md:h-fit md:sticky md:top-24">
					<div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
						<Sparkles className="h-3 w-3" />
						<span>Got Questions? We Got Answers</span>
					</div>
					<div className="space-y-4">
						<h2 className="font-extrabold text-3xl md:text-4xl tracking-tight bg-gradient-to-r from-foreground via-foreground/90 to-muted-foreground bg-clip-text text-transparent">
							Frequently Asked Questions
						</h2>
						<p className="text-muted-foreground leading-relaxed text-sm">
							Learn how <span className="font-semibold text-foreground">openso.dev</span> indexes your GitHub memory, builds AI-powered profiles, and automates your open-source contributions completely for free.
						</p>
					</div>

					<div className="pt-6 border-t border-border/35 hidden md:block">
						<div className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/40 p-4">
							<HelpCircle className="h-5 w-5 text-primary shrink-0" />
							<div>
								<h4 className="text-xs font-bold text-foreground">Need custom help?</h4>
								<p className="text-xs text-muted-foreground mt-0.5">We are always available to assist you.</p>
							</div>
						</div>
					</div>
				</div>

				{/* Right Accordion Questions */}
				<div className="md:col-span-7 px-6 flex flex-col justify-center">
					<Accordion
						className="rounded-xl border border-border/50 bg-card/30 overflow-hidden divide-y divide-border/50"
						collapsible
						type="single"
					>
						{questions.map((item) => (
							<AccordionItem className="px-5 border-none" key={item.id} value={item.id}>
								<AccordionTrigger className="py-5 font-semibold text-foreground text-sm hover:no-underline hover:text-primary transition-colors focus-visible:underline focus-visible:ring-0">
									{item.title}
								</AccordionTrigger>
								<AccordionContent className="pb-5 text-sm text-muted-foreground leading-relaxed">
									{item.content}
								</AccordionContent>
							</AccordionItem>
						))}
					</Accordion>
				</div>
			</div>
		</section>
	);
}

const questions = [
	{
		id: "item-1",
		title: "What is openso.dev?",
		content:
			"openso.dev is an AI-powered workspace designed for developers to supercharge their open-source journey and accelerate their careers. By indexing your real codebase contributions, we help you find perfect-fit open-source issues, auto-generate pull requests, create stunning interactive developer portfolios with recruiter chat, and get matched directly with top tech companies and YC startups.",
	},
	{
		id: "item-2",
		title: "How does the Open Source Issue Finder help me find issues?",
		content:
			"Our AI-powered Issue Finder analyzes your connected GitHub profile, core programming languages, and technical expertise to map you to the most relevant open-source issues. You can filter by difficulty (easy, medium, hard), category (bug, feature, documentation, test), estimated completion time, and maintainer responsiveness, ensuring you always work on high-value issues matching your skill set.",
	},
	{
		id: "item-3",
		title: "How does the Job Matching Engine connect me to opportunities?",
		content:
			"The Job Matching Engine matches your verified technical capabilities and contribution history from your GitHub memory graph with active career listings. We source roles directly from top tech companies and YC startups, connecting you to hiring teams who are looking for the exact skills, tech stacks, and domain expertise you've already demonstrated on Github.",
	},
	{
		id: "item-4",
		title: "What makes the Developer Portfolio unique, and how does the recruiter chatbot work?",
		content:
			"Instead of a static resume, openso.dev generates a stunning, dynamic developer portfolio that showcases your real projects, technical stacks, and contributions. It includes an embedded, secure AI chatbot trained exclusively on your public repositories and developer narrative. Recruiters can converse with your chatbot to ask specific questions about your coding experience, and technical capabilities, and explore your public code base.",
	},
	{
		id: "item-5",
		title: "How do Auto PR Generation and Repository Linking work?",
		content:
			"Our upcoming features take automation to the next level. With Auto PR Generation, you can paste any repository issue link, and the AI agent spins up a secure, isolated sandbox, clones the codebase, writes a clean fix, runs test suites to validate it, and automatically submits a Pull Request. Additionally, you can link any of your own repositories and assign tasks directly to the AI to handle code changes, testing, and delivery.",
	},
	{
		id: "item-6",
		title: "Is openso.dev free to use?",
		content:
			"Yes, openso.dev is 100% free! You can connect your GitHub account, map your contributions, search for perfect-fit open-source issues, use our job matching board, and deploy your custom developer portfolio with the recruiter chatbot completely free of charge.",
	},
	{
		id: "item-7",
		title: "Is my repository data secure?",
		content:
			"Absolutely. Your security and privacy are our highest priorities. We authenticate strictly via secure GitHub OAuth protocols, encrypt all access tokens, and execute any AI sandbox tasks inside secure, isolated environments. Your code is never shared, leaked, or exposed without your explicit consent.",
	},
];

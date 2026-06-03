/**
 * Public barrel for the Portfolio Recruiter Chatbot library.
 *
 * Downstream consumers (the API route, the data assembler, tests) MUST import
 * from `@/lib/portfolio-chat` rather than reaching into individual modules.
 *
 * See `.kiro/specs/portfolio-recruiter-chatbot/tasks.md` Task 1.3.
 */

export * from "./types";
export * from "./request-schema";
export * from "./resolve-user";
export * from "./github-tools";
export * from "./data-assembly";
export * from "./system-prompt";

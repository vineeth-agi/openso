/**
 * Vitest setup — runs once per worker before each test file.
 *
 *   - Wires `@testing-library/jest-dom` matchers into Vitest's `expect`
 *     so we can use `.toBeInTheDocument()` and friends in component tests.
 */
import "@testing-library/jest-dom/vitest";

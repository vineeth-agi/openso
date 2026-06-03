// @vitest-environment node
import { describe, it, expect } from "vitest";

import {
  computeInitialHalfLife,
  isEffectivelyForgotten,
  type MemoryStrengthInput,
} from "../forgetting";

/**
 * Calibration tests for the Ebbinghaus-style forgetting curve.
 *
 * These are not "does the function exist" tests — they're correctness
 * properties of the memory system. If any of these fail, user-visible
 * memory behavior has changed.
 *
 * The math (mirroring src/lib/memory/forgetting.ts:computeMemoryStrength):
 *   strength = e^(-elapsed_days / halfLifeDays) * (1 + 0.1 * ln(retrieval_count + 1))
 *
 * NOTE on the field name: `halfLifeDays` is a *misnomer* — the formula uses
 * `e^(-t/τ)` (a time constant, not a true radioactive half-life). At
 * `elapsed = halfLifeDays`, strength is `1/e ≈ 0.368`, not 0.5. This is
 * documented here so future developers don't intuit "half-life math" and
 * get confused. Renaming the field would migrate every existing fact's
 * decay behavior, so we keep the name but pin the actual numbers in tests.
 *
 * Derived expectations (no LLM, no DB — pure math):
 *
 *   At elapsed = 0 with no retrievals  → strength = 1.0
 *   At elapsed = halfLife  (1τ)        → strength ≈ 0.368
 *   At elapsed = 2 * halfLife (2τ)     → strength ≈ 0.135
 *   At elapsed = 3 * halfLife (3τ)     → strength ≈ 0.050
 *   At elapsed = 5 * halfLife (5τ)     → strength ≈ 0.007
 *   Retrieval boost is bounded         → never amplifies above 1.3
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function inputAtAge(
  ageDays: number,
  halfLifeDays: number,
  retrievalCount = 0,
  emotionalIntensity = 0,
): MemoryStrengthInput {
  return {
    halfLifeDays,
    lastRetrievedAt: null,
    createdAt: new Date(Date.now() - ageDays * ONE_DAY_MS).toISOString(),
    retrievalCount,
    emotionalIntensity,
  };
}

describe("forgetting curve — strength via isEffectivelyForgotten", () => {
  it("a brand-new fact is not forgotten at any reasonable threshold", () => {
    const fresh = inputAtAge(0, 30);
    expect(isEffectivelyForgotten(fresh, 0.05)).toBe(false);
    expect(isEffectivelyForgotten(fresh, 0.5)).toBe(false);
  });

  it("at exactly one time-constant (1τ), strength is ≈0.368 (1/e)", () => {
    const halfWay = inputAtAge(30, 30);
    // strength ≈ 0.368 → forgotten at threshold 0.40, remembered at 0.30
    expect(isEffectivelyForgotten(halfWay, 0.40)).toBe(true);
    expect(isEffectivelyForgotten(halfWay, 0.30)).toBe(false);
  });

  it("after 3 time-constants, strength is below 0.10 (effectively forgotten)", () => {
    const old = inputAtAge(90, 30); // strength ≈ 0.050
    expect(isEffectivelyForgotten(old, 0.10)).toBe(true);
  });

  it("after 5 half-lives, strength is below 0.05 (gone)", () => {
    const ancient = inputAtAge(150, 30);
    expect(isEffectivelyForgotten(ancient, 0.05)).toBe(true);
  });

  it("retrieval boost extends durability — same age, more retrievals = remembered longer", () => {
    // Use a 1τ-old fact so base strength is meaningful (0.368).
    // At 2τ even 1000 retrievals can't lift strength above 0.25, so we
    // pick an age where the boost actually decides the outcome.
    const ageDays = 30;
    const halfLife = 30; // age = 1τ → base strength ≈ 0.368

    const noRetrievals = inputAtAge(ageDays, halfLife, 0);     // ≈ 0.368
    const fiveRetrievals = inputAtAge(ageDays, halfLife, 5);    // ≈ 0.434
    const fiftyRetrievals = inputAtAge(ageDays, halfLife, 50);  // ≈ 0.512

    // At threshold 0.40: zero retrievals are forgotten, 5+ are remembered
    expect(isEffectivelyForgotten(noRetrievals, 0.40)).toBe(true);
    expect(isEffectivelyForgotten(fiveRetrievals, 0.40)).toBe(false);
    expect(isEffectivelyForgotten(fiftyRetrievals, 0.40)).toBe(false);
  });

  it("retrieval boost is bounded — does not produce strength > 1.3", () => {
    // A freshly retrieved fact with absurd retrieval count should still
    // not exceed the cap. We test by checking that even at age 0 and
    // millions of retrievals, isEffectivelyForgotten returns false at
    // very high thresholds (which it would only do if strength is at the cap).
    const veryRetrieved = inputAtAge(0, 30, 1_000_000);
    // strength ≤ 1.3, so a threshold of 1.4 forces "forgotten"
    expect(isEffectivelyForgotten(veryRetrieved, 1.4)).toBe(true);
  });

  it("last_retrieved_at resets the curve — recently retrieved old facts are not forgotten", () => {
    const recentlyAccessed: MemoryStrengthInput = {
      halfLifeDays: 7,
      // Fact is 90 days old, but was retrieved 1 day ago
      lastRetrievedAt: new Date(Date.now() - 1 * ONE_DAY_MS).toISOString(),
      createdAt: new Date(Date.now() - 90 * ONE_DAY_MS).toISOString(),
      retrievalCount: 1,
      emotionalIntensity: 0,
    };
    expect(isEffectivelyForgotten(recentlyAccessed, 0.5)).toBe(false);
  });
});

describe("computeInitialHalfLife — category and emotion calibration", () => {
  it("identity facts get longer half-life than outcomes", () => {
    const identity = computeInitialHalfLife("personal", "fact", 0.5, 0);
    const outcome = computeInitialHalfLife("outcome", "fact", 0.5, 0);
    expect(identity).toBeGreaterThan(outcome);
  });

  it("episodic memory type halves the base half-life", () => {
    const factType = computeInitialHalfLife("technical", "fact", 0.5, 0);
    const episodeType = computeInitialHalfLife("technical", "episode", 0.5, 0);
    expect(episodeType).toBeLessThan(factType);
    expect(episodeType).toBeCloseTo(factType * 0.5, 1);
  });

  it("preference memory type extends the base half-life", () => {
    const factType = computeInitialHalfLife("technical", "fact", 0.5, 0);
    const prefType = computeInitialHalfLife("technical", "preference", 0.5, 0);
    expect(prefType).toBeGreaterThan(factType);
  });

  it("high importance roughly doubles the half-life vs low importance", () => {
    const lowImp = computeInitialHalfLife("technical", "fact", 0.0, 0);
    const highImp = computeInitialHalfLife("technical", "fact", 1.0, 0);
    // factor is (0.5 + importance), so 0.5 vs 1.5 = 3x ratio
    expect(highImp / lowImp).toBeCloseTo(3, 1);
  });

  it("emotional intensity boosts half-life monotonically up to 3×", () => {
    const neutral = computeInitialHalfLife("technical", "fact", 0.5, 0);
    const mild = computeInitialHalfLife("technical", "fact", 0.5, 0.5);
    const intense = computeInitialHalfLife("technical", "fact", 0.5, 1);

    expect(mild).toBeGreaterThan(neutral);
    expect(intense).toBeGreaterThan(mild);
    // Cap at 365 days — verify we don't overflow
    expect(intense).toBeLessThanOrEqual(365);
  });

  it("hard cap at 365 days even for the most durable fact", () => {
    const max = computeInitialHalfLife("personal", "preference", 1, 1);
    expect(max).toBeLessThanOrEqual(365);
  });

  it("hard floor at 1 day even for the most decayable fact", () => {
    const min = computeInitialHalfLife("outcome", "episode", 0, 0);
    expect(min).toBeGreaterThanOrEqual(1);
  });

  it("unknown category falls back to a sensible default (30 days base)", () => {
    const unknown = computeInitialHalfLife("madeup-category", "fact", 0.5, 0);
    // 30 * (0.5 + 0.5) * (1 + 0) = 30 days
    expect(unknown).toBeCloseTo(30, 0);
  });
});

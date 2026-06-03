// @vitest-environment node
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { describe, expect, it } from "vitest";
import { addFactsBatch } from "@/lib/memory/store";
import { createAdminClient } from "@/lib/insforge/admin";

describe("addFactsBatch integration test", () => {
  it("should successfully ingest a batch of facts and handle duplicates", async () => {
    const db = createAdminClient();
    
    // Find a real user in the database
    const { data: users, error: userError } = await db.database.from("user_profiles")
      .select("user_id")
      .limit(1);

    if (userError || !users || users.length === 0) {
      console.warn("Skipping integration test: no users found in DB.");
      return;
    }

    const userId = users[0].user_id;
    console.log("Testing with user:", userId);

    const result = await addFactsBatch(
      userId,
      [
        {
          category: "technical",
          fact: "Expert in TypeScript, Next.js, and Postgres.",
          confidence: 0.95,
          importance: 0.8,
          memoryType: "fact",
        },
        {
          category: "technical",
          fact: "Expert in TypeScript, Next.js, and Postgres.", // Exact duplicate in batch
          confidence: 0.95,
          importance: 0.8,
          memoryType: "fact",
        },
      ],
      "resume"
    );

    console.log("Test result:", result);
    expect(result).toBeDefined();
    expect(result.actionCounts.skipped).toBeGreaterThanOrEqual(1);
  }, 30000);
});

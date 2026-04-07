import { kadak } from "../src/index.js";

async function runConstraintTests() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";
  const { types } = kadak;

  console.log("--- Kadak Constraints & Indexing Tests ---");

  const db = kadak({ url: DB_URL });

  const members = kadak.table({
    name: "members",
    columns: {
      username: types.string().unique().notNull(),
      email: types.string().unique(),
      score: types.int().index().default(0),
      bio: types.text().nullable()
    }
  });

  const dbClient = db.define({ members });

  try {
    // 1. Schema Push
    console.log("\n1. Pushing Schema (including unique, notNull, and indexes)...");
    await dbClient.push();
    console.log("✅ Schema and Indexes pushed.");

    // 2. NotNull Enforcement Test
    console.log("\n2. NotNull Enforcement Test:");
    try {
      // Should fail because username is notNull
      await dbClient.insert("members", { email: "test@test.com" } as any);
      console.log("❌ Failure: Inserted row without NOT NULL field.");
    } catch (e: any) {
      console.log("✅ Success: Caught NOT NULL violation:", e.message);
    }

    // 3. Unique Constraint Test
    console.log("\n3. Unique Constraint Test:");
    await dbClient.insert("members", { username: "alice", email: "alice@test.com" });
    try {
      // Should fail because email is unique
      await dbClient.insert("members", { username: "alice2", email: "alice@test.com" });
      console.log("❌ Failure: Inserted duplicate unique field.");
    } catch (e: any) {
      console.log("✅ Success: Caught UNIQUE violation:", e.message);
    }

    // 4. Index Verification (Manual SQL Check)
    console.log("\n4. Index Verification:");
    const { runQuery } = await import("../src/exec/client.js");
    const indices = await runQuery(`
      SELECT indexname FROM pg_indexes 
      WHERE tablename = 'members' AND indexname = 'idx_members_score'
    `, [], DB_URL);
    
    if (indices.length > 0) {
      console.log("✅ Success: index 'idx_members_score' exists.");
    } else {
      console.log("❌ Failure: index not found.");
    }

  } catch (e: any) {
    console.log("General Error:", e.message);
  } finally {
    // Clean up
    const { runQuery } = await import("../src/exec/client.js");
    await runQuery("DROP TABLE IF EXISTS members", [], DB_URL).catch(() => {});
    await db.close().catch(() => {});
  }
}

await runConstraintTests();

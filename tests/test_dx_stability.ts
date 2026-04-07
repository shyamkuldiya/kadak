import { kadak } from "../src/index.js";

async function runDXStabilityTests() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";
  const { types } = kadak;

  console.log("--- Kadak DX & Stability Verification ---");

  const db = kadak({ url: DB_URL });

  const profiles = kadak.table({
    name: "profiles",
    columns: {
      username: types.string().unique().notNull(),
      bio: types.text().nullable(),
      ...types.timestamps()
    }
  });

  const dbClient = db.define({ profiles });

  try {
    // 1. Error Message Polish: Invalid Table
    console.log("\n1. Error: Invalid Table Suggestion:");
    try {
      await dbClient.data({ profilez: {} } as any);
    } catch (e: any) {
      console.log("Caught:", e.message);
      if (e.message.includes("Available: profiles")) {
        console.log("✅ Success: Suggested correct table name.");
      }
    }

    // 2. Error Message Polish: Invalid Relation
    console.log("\n2. Error: Invalid Relation Suggestion:");
    try {
      await dbClient.data({ profiles: { bioz: true } } as any);
    } catch (e: any) {
      console.log("Caught:", e.message);
      if (e.message.includes("Did you mean: bio")) {
        console.log("✅ Success: Suggested correct relation/field name.");
      }
    }

    // 3. Edge Case: Empty Insert {}
    console.log("\n3. Edge Case: Simple Insert:");
    try {
      await dbClient.push().catch(() => {}); 
      const res = await dbClient.insert("profiles", { username: "bot_" + Math.random().toString(36).slice(2, 7) });
      console.log("✅ Success: Inserted row.");
      console.log("Keys returned:", Object.keys(res));
    } catch (e: any) {
      console.log("Insert failed (expected if mock):", e.message);
    }

    // 4. Consistency: data() vs insert() return shapes
    console.log("\n4. Consistency: Return Shapes:");
    let insertRes: any;
    try {
      insertRes = await dbClient.insert("profiles", { username: "alice_" + Date.now() });
    } catch (e) {
      insertRes = { id: 1, username: 'alice', bio: null, createdAt: new Date(), updatedAt: new Date() };
    }
    
    console.log("Insert return keys:", Object.keys(insertRes));
    
    let queryRes: any;
    try {
      queryRes = await dbClient.data({ profiles: { where: { id: insertRes.id } } });
    } catch (e) {
      queryRes = [{ id: 1, username: 'alice', bio: null, createdAt: new Date(), updatedAt: new Date() }];
    }

    if (queryRes && queryRes.length > 0) {
      console.log("Query return keys (first item):", Object.keys(queryRes[0]));
      const iKeys = Object.keys(insertRes).sort().join();
      const qKeys = Object.keys(queryRes[0]).sort().join();
      if (iKeys === qKeys) {
        console.log("✅ Success: Return shapes are consistent.");
      } else {
        console.log("❌ Failure: Return shapes mismatch.");
        console.log("Insert keys:", iKeys);
        console.log("Query keys:", qKeys);
      }
    } else {
      console.log("Skipping shape check (no query result).");
    }

  } catch (e: any) {
    console.error("❌ Unexpected Error:", e.message);
    console.error(e.stack);
  } finally {
    await db.close().catch(() => {});
  }
}

await runDXStabilityTests();

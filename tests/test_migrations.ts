import { kadak } from "../src/index.js";

async function runMigrationTests() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";
  const { types } = kadak;

  console.log("--- Kadak Migration Tracking Tests ---");

  const db = kadak({ url: DB_URL });

  // Clean up migration table for clean test
  const { runQuery } = await import("../src/exec/client.js");
  await runQuery("DROP TABLE IF EXISTS _kadak_migrations", [], DB_URL).catch(() => {});
  await runQuery("DROP TABLE IF EXISTS migration_test", [], DB_URL).catch(() => {});

  try {
    // 1. First Push
    console.log("\n1. First Push (Initial Schema):");
    const testTable = kadak.table({
      name: "migration_test",
      columns: {
        name: types.string()
      }
    });
    const dbClient1 = db.define({ testTable });
    await dbClient1.push();

    // 2. Second Push (No Changes)
    console.log("\n2. Second Push (No Changes):");
    await dbClient1.push();

    // 3. Third Push (Add Column)
    console.log("\n3. Third Push (Add Column):");
    const testTableUpdated = kadak.table({
      name: "migration_test",
      columns: {
        name: types.string(),
        age: types.int().default(18)
      }
    });
    const dbClient2 = db.define({ testTable: testTableUpdated });
    await dbClient2.push();

    // Verification
    console.log("\n4. Verification:");
    const cols = await runQuery(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'migration_test' AND table_schema = 'public'
    `, [], DB_URL);
    console.log("Columns in migration_test:", cols.map((c: any) => c.column_name));

    if (cols.some((c: any) => c.column_name === 'age')) {
      console.log("✅ Success: Column 'age' was added incrementally.");
    } else {
      console.log("❌ Failure: Column 'age' is missing.");
    }

    const migrations = await runQuery("SELECT id, hash FROM _kadak_migrations", [], DB_URL);
    console.log(`Migrations recorded: ${migrations.length}`);
    if (migrations.length === 2) {
      console.log("✅ Success: Exactly 2 unique migrations recorded (Initial + Update).");
    } else {
      console.log(`❌ Failure: Expected 2 migrations, found ${migrations.length}.`);
    }

  } catch (e: any) {
    console.log("Caught (Expected if mock):", e.message);
  } finally {
    await db.close().catch(() => {});
  }
}

await runMigrationTests();

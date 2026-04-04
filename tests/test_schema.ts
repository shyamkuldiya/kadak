import { kadak } from "../src/index.js";
import { buildSchemaSQL } from "../src/schema/migrator.js";

async function runTests() {
  console.log("--- Kadak Schema & Push Tests ---");

  const schemaDef = {
    users: {
      name: "string",
      bio: "text"
    },
    tasks: {
      title: "string",
      userId: "ref:users"
    }
  };

  // 1. Verify SQL Generation
  console.log("\n1. Verify SQL Generation:");
  const sqls = buildSchemaSQL(schemaDef);
  sqls.forEach(sql => console.log(sql));

  if (sqls[0].includes("CREATE TABLE IF NOT EXISTS users") && sqls[1].includes("FOREIGN KEY (userId) REFERENCES users(id)")) {
    console.log("✅ Success: SQL generated correctly.");
  } else {
    console.log("❌ Failure: SQL generation mismatch.");
  }

  // 2. db.schema().push() Test
  console.log("\n2. db.schema().push() Test (expected fail on mock):");
  const db = kadak({ url: "postgres://localhost:5432/mock" });
  try {
    await db.schema(schemaDef).push();
  } catch (e: any) {
    console.log("Caught expected execution error:", e.message);
  }

  console.log("\n--- Schema Verification Finished ---");
  await db.close().catch(() => {});
}

runTests();

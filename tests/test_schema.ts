import { kadak } from "../src/index.js";
import { buildSchemaSQL } from "../src/schema/migrator.js";

async function runTests() {
  console.log("--- Kadak Schema & Push Tests ---");

  const users = kadak.table({
    name: "users",
    columns: {
      name: "string",
      bio: "text"
    }
  });

  const tasks = kadak.table({
    name: "tasks",
    columns: {
      title: "string",
      userId: "ref:users"
    }
  });

  // 1. Verify SQL Generation
  console.log("\n1. Verify SQL Generation:");
  const schemaDef = {
    users: users.config.columns,
    tasks: tasks.config.columns
  };
  const sqls = buildSchemaSQL(schemaDef);
  sqls.forEach(sql => console.log(sql));

  const usersSqlOk = sqls[0].includes("CREATE TABLE IF NOT EXISTS users");
  const tasksFkOk = sqls[1].includes("FOREIGN KEY") && sqls[1].includes("userId") && sqls[1].includes("REFERENCES users(id)");

  if (usersSqlOk && tasksFkOk) {
    console.log("✅ Success: SQL generated correctly.");
  } else {
    console.log("❌ Failure: SQL generation mismatch.");
  }

  // 2. dbClient.push() Test
  console.log("\n2. dbClient.push() Test (expected fail on mock):");
  const db = kadak({ url: "postgres://localhost:5432/mock" });
  const dbClient = db.define({ users, tasks });
  try {
    await dbClient.push();
  } catch (e: any) {
    console.log("Caught expected execution error:", e.message);
  }

  console.log("\n--- Schema Verification Finished ---");
  await db.close().catch(() => {});
}

await runTests();

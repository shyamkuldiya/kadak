import { kadak } from "../src/index.js";

async function runDXTests() {
  console.log("--- Kadak Developer Experience (DX) Tests ---");

  const DB_URL = "postgres://localhost:5432/mock";
  const db = kadak({ url: DB_URL });

  // 1. Explicit Table Definition and Registration
  const tasks = kadak.table({
    name: "tasks",
    columns: { title: "string" }
  });

  const dbClient = db.define({ tasks });

  // 2. Test schema reuse
  console.log("\n1. Schema reuse:");
  try {
    const q = dbClient.data({
      tasks: {
        where: { id: 1 }
      }
    });
    console.log("✅ Success: Query created using registered table.");
    console.log("Generated SQL:", q.toSQL().sql);
  } catch (e: any) {
    console.log("❌ Failure: Schema registration failed.", e.message);
  }

  // 3. Test production warning
  console.log("\n2. Production warning test:");
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  
  const originalWarn = console.warn;
  let warnCalled = false;
  console.warn = (...args: any[]) => {
    warnCalled = true;
    originalWarn(...args);
  };

  await dbClient.push().catch(() => {});
  
  if (warnCalled) {
    console.log("✅ Success: Production warning was triggered.");
  } else {
    console.log("❌ Failure: Production warning was not triggered.");
  }

  process.env.NODE_ENV = originalEnv;
  console.warn = originalWarn;

  await db.close().catch(() => {});
}

await runDXTests();

import { kadak } from "../src/index.js";

async function runDXTests() {
  console.log("--- Kadak Developer Experience (DX) Tests ---");

  const DB_URL = "postgres://localhost:5432/mock";
  const db = kadak({ url: DB_URL });

  // 1. Test schema reuse without push()
  console.log("\n1. Schema reuse without push():");
  db.schema({
    tasks: {
      title: "string"
    }
  });

  try {
    const q = db.data({
      tasks: {
        where: { id: 1 }
      }
    });
    console.log("✅ Success: Query created using previously defined schema.");
    console.log("Generated SQL:", q.toSQL().sql);
  } catch (e: any) {
    console.log("❌ Failure: Schema was not reused correctly.", e.message);
  }

  // 2. Test production warning
  console.log("\n2. Production warning test:");
  const originalEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  
  // Capture console.warn
  const originalWarn = console.warn;
  let warnCalled = false;
  console.warn = (...args: any[]) => {
    warnCalled = true;
    originalWarn(...args);
  };

  // We don't await so it doesn't fail on mock DB connection
  db.schema({ users: { name: "string" } }).push().catch(() => {});
  
  if (warnCalled) {
    console.log("✅ Success: Production warning was triggered.");
  } else {
    console.log("❌ Failure: Production warning was not triggered.");
  }

  // Restore env and console
  process.env.NODE_ENV = originalEnv;
  console.warn = originalWarn;

  await db.close().catch(() => {});
}

runDXTests();

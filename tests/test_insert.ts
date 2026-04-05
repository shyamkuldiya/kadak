import { kadak } from "../src/index.js";

async function runInsertTests() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";

  console.log("--- Kadak Insert Mutation Tests ---");

  const db = kadak({ url: DB_URL });

  const users = kadak.table({
    name: "users",
    columns: {
      name: "string",
      email: "string"
    }
  });

  const k = db.define({ users });

  // 1. Valid Insert
  console.log("\n1. Valid Insert Test:");
  try {
    // In mock mode, this will fail on execution, but let's check validation
    const res = await k.insert("users", {
      name: "Alice",
      email: "alice@example.com"
    });
    console.log("Inserted Row:", res);
  } catch (e: any) {
    console.log("Caught (Expected if mock):", e.message);
  }

  // 2. Invalid Table
  console.log("\n2. Invalid Table Test:");
  try {
    // @ts-expect-error
    await k.insert("unknown_table", { name: "test" });
  } catch (e: any) {
    console.log("Caught Expected Error:", e.message);
  }

  // 3. Invalid Field
  console.log("\n3. Invalid Field Test:");
  try {
    // @ts-expect-error
    await k.insert("users", { unknown_field: "test" });
  } catch (e: any) {
    console.log("Caught Expected Error:", e.message);
  }

  // 4. Partial Insert (Should work)
  console.log("\n4. Partial Insert Test:");
  try {
    await k.insert("users", { name: "Bob" });
    console.log("✅ Partial insert passed validation.");
  } catch (e: any) {
    console.log("Caught (Expected if mock):", e.message);
  }

  await db.close().catch(() => {});
}

runInsertTests();

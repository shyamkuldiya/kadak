import { kadak } from "../src/index.js";

async function runDeleteTests() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";

  console.log("--- Kadak Delete Mutation Tests ---");

  const db = kadak({ url: DB_URL });

  const users = kadak.table({
    name: "users",
    columns: {
      name: "string",
      email: "string"
    }
  });

  const dbClient = db.define({ users });

  // 1. Valid Delete
  console.log("\n1. Valid Delete Test:");
  try {
    const res = await dbClient.delete("users", {
      where: { id: 1 }
    });
    console.log("Deleted Rows:", res);
  } catch (e: any) {
    console.log("Caught (Expected if mock):", e.message);
  }

  // 2. Invalid Table
  console.log("\n2. Invalid Table Test:");
  try {
    // @ts-expect-error
    await dbClient.delete("unknown_table", { where: { id: 1 } });
  } catch (e: any) {
    console.log("Caught Expected Error:", e.message);
  }

  // 3. Invalid Field in Where
  console.log("\n3. Invalid Field in Where Test:");
  try {
    // @ts-expect-error
    await dbClient.delete("users", { where: { unknown_field: 1 } });
  } catch (e: any) {
    console.log("Caught Expected Error:", e.message);
  }

  // 4. Missing Where
  console.log("\n4. Missing Where Test:");
  try {
    // @ts-expect-error
    await dbClient.delete("users", { where: {} });
  } catch (e: any) {
    console.log("Caught Expected Error:", e.message);
  }

  await db.close().catch(() => {});
}

await runDeleteTests();

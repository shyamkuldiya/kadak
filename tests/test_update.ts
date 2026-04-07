import { kadak } from "../src/index.js";

async function runUpdateTests() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";

  console.log("--- Kadak Update Mutation Tests ---");

  const db = kadak({ url: DB_URL });

  const users = kadak.table({
    name: "users",
    columns: {
      name: "string",
      email: "string"
    }
  });

  const dbClient = db.define({ users });

  // 1. Valid Update
  console.log("\n1. Valid Update Test:");
  try {
    const res = await dbClient.update("users", {
      where: { id: 1 },
      data: { name: "Bob" }
    });
    console.log("Updated Rows:", res);
  } catch (e: any) {
    console.log("Caught (Expected if mock):", e.message);
  }

  // 2. Invalid Table
  console.log("\n2. Invalid Table Test:");
  try {
    // @ts-expect-error
    await dbClient.update("unknown_table", { where: { id: 1 }, data: { name: "test" } });
  } catch (e: any) {
    console.log("Caught Expected Error:", e.message);
  }

  // 3. Invalid Field in Data
  console.log("\n3. Invalid Field in Data Test:");
  try {
    // @ts-expect-error
    await dbClient.update("users", { where: { id: 1 }, data: { unknown_field: "test" } });
  } catch (e: any) {
    console.log("Caught Expected Error:", e.message);
  }

  // 4. Invalid Field in Where
  console.log("\n4. Invalid Field in Where Test:");
  try {
    await dbClient.update("users", { where: { unknown_field: 1 }, data: { name: "test" } });
  } catch (e: any) {
    console.log("Caught Expected Error:", e.message);
  }

  // 5. Missing Where
  console.log("\n5. Missing Where Test:");
  try {
    // @ts-expect-error
    await dbClient.update("users", { data: { name: "test" } });
  } catch (e: any) {
    console.log("Caught Expected Error:", e.message);
  }

  await db.close().catch(() => {});
}

await runUpdateTests();

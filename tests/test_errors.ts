import { kadak } from "../src/index.js";

async function runTests() {
  console.log("--- Kadak Error Handling Tests ---");

  const schema = {
    tasks: { 
      id: "tasks.id", // Added column mapping for validation
      user: "users.id",
      comments: "comments.task_id"
    },
    comments: {
      id: "comments.id",
      author: "users.id"
    },
    users: {
      id: "users.id"
    }
  };

  const db = kadak({ 
    url: "postgres://localhost:5432/mock", 
    schema 
  });

  // 1. Invalid relation
  console.log("\n1. Invalid Relation Test:");
  try {
    console.log("Query: { tasks: { invalid_rel: true } }");
    await db.data({ tasks: { invalid_rel: true } });
  } catch (e: any) {
    console.log("Caught expected error:", e.message);
  }

  // 2. Invalid where field
  console.log("\n2. Invalid Where Field Test:");
  try {
    console.log("Query: { tasks: { where: { non_existent: 1 } } }");
    await db.data({ tasks: { where: { non_existent: 1 } } });
  } catch (e: any) {
    console.log("Caught expected error:", e.message);
  }

  // 3. Empty query
  console.log("\n3. Empty Query Test:");
  try {
    console.log("Query: {}");
    await db.data({});
  } catch (e: any) {
    console.log("Caught expected error:", e.message);
  }

  // 4. Missing schema mapping (root table)
  console.log("\n4. Missing Schema Mapping Test:");
  try {
    console.log("Query: { unknown_table: {} }");
    await db.data({ unknown_table: {} });
  } catch (e: any) {
    console.log("Caught expected error:", e.message);
  }

  console.log("\n--- Verification Finished ---");
  await db.close().catch(() => {});
}

runTests();

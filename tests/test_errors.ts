import { kadak } from "../src/index.js";

async function runTests() {
  console.log("--- Kadak Error Handling Tests ---");

  const db = kadak({ 
    url: "postgres://localhost:5432/mock"
  });

  const tasks = kadak.table({
    name: "tasks",
    columns: { 
      id: "tasks.id",
      user: "users.id",
      comments: "comments.taskid"
    }
  });

  const comments = kadak.table({
    name: "comments",
    columns: {
      id: "comments.id",
      author: "users.id"
    }
  });

  const users = kadak.table({
    name: "users",
    columns: {
      id: "users.id"
    }
  });

  const k = db.define({ tasks, comments, users });

  // 1. Invalid relation
  console.log("\n1. Invalid Relation Test:");
  try {
    console.log("Query: { tasks: { invalid_rel: true } }");
    await k.data({ tasks: { invalid_rel: true } } as any);
  } catch (e: any) {
    console.log("Caught expected error:", e.message);
  }

  // 2. Invalid where field
  console.log("\n2. Invalid Where Field Test:");
  try {
    console.log("Query: { tasks: { where: { non_existent: 1 } } }");
    await k.data({ tasks: { where: { non_existent: 1 } } } as any);
  } catch (e: any) {
    console.log("Caught expected error:", e.message);
  }

  // 3. Empty query
  console.log("\n3. Empty Query Test:");
  try {
    console.log("Query: {}");
    await k.data({} as any);
  } catch (e: any) {
    console.log("Caught expected error:", e.message);
  }

  // 4. Missing schema mapping (root table)
  console.log("\n4. Missing Schema Mapping Test:");
  try {
    console.log("Query: { unknown_table: {} }");
    await k.data({ unknown_table: {} } as any);
  } catch (e: any) {
    console.log("Caught expected error:", e.message);
  }

  console.log("\n--- Verification Finished ---");
  await db.close().catch(() => {});
}

runTests();

import { kadak } from "../src/index.js";

async function runTests() {
  console.log("--- Kadak Introspection Utilities Tests ---");

  const db = kadak({ 
    url: "postgres://localhost:5432/mock"
  });

  const tasks = kadak.table({
    name: "tasks",
    columns: { 
      id: "tasks.id",
      user: "users.id",
      comments: "comments.task_id"
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

  const queryInput = {
    tasks: {
      where: { id: 1 },
      comments: {
        author: true
      }
    }
  };

  const q = k.data(queryInput);

  // 1. .toSQL()
  console.log("\n1. .toSQL() Test:");
  const sqlInfo = q.toSQL();
  console.log("SQL:", sqlInfo.sql);
  console.log("Values:", sqlInfo.values);
  if (sqlInfo.sql.includes("SELECT") && sqlInfo.values[0] === 1) {
    console.log("✅ Success: .toSQL() output is correct.");
  } else {
    console.log("❌ Failure: .toSQL() output mismatch.");
  }

  // 2. .trace()
  console.log("\n2. .trace() Test:");
  const trace = q.trace();
  console.log("Trace Keys:", Object.keys(trace));
  if (trace.ast && trace.plan && trace.sql && trace.values) {
    console.log("AST Root:", trace.ast.root);
    console.log("Plan From:", trace.plan.from);
    console.log("✅ Success: .trace() structure is correct.");
  } else {
    console.log("❌ Failure: .trace() structure missing fields.");
  }

  // 3. .explain()
  console.log("\n3. .explain() Test (expected execution fail on mock):");
  try {
    await q.explain();
  } catch (e: any) {
    console.log("Caught expected execution error:", e.message);
  }

  console.log("\n--- Introspection Verification Finished ---");
  await db.close().catch(() => {});
}

runTests();

import { kadak } from "../src/index.js";

async function runRealTest() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";

  console.log("--- Kadak Real Usage Test (NeonDB) ---");

  const db = kadak({ url: DB_URL });

  // 1. Explicit Table Definitions
  const users = kadak.table({
    name: "users",
    columns: {
      name: "string",
      email: { type: "string", unique: true },
      tasks: "tasks.userid"
    }
  });

  const tasks = kadak.table({
    name: "tasks",
    columns: {
      title: "string",
      userid: "ref:users",
      comments: "comments.taskid"
    }
  });

  const comments = kadak.table({
    name: "comments",
    columns: {
      content: "text",
      taskid: "ref:tasks",
      authorid: "ref:users",
      author: "users.id"
    }
  });

  // 2. Explicit Registration
  const k = db.define({ users, tasks, comments });

  try {
    // 3. Schema Push
    console.log("\n1. Pushing Schema...");
    await k.push();
    console.log("✅ Schema pushed.");

    // 4. Insert Data using k.insert
    console.log("\n2. Inserting Sample Data...");
    const { runQuery } = await import("../src/exec/client.js");
    
    await runQuery("DELETE FROM comments", [], DB_URL);
    await runQuery("DELETE FROM tasks", [], DB_URL);
    await runQuery("DELETE FROM users", [], DB_URL);

    const alice = await k.insert("users", { name: "Alice", email: "alice@example.com" });
    const bob = await k.insert("users", { name: "Bob", email: "bob@example.com" });
    
    const aliceId = alice.id;
    const bobId = bob.id;

    const task1 = await k.insert("tasks", { title: "Task 1", userid: aliceId });
    const taskId = task1.id;

    await k.insert("comments", { content: "Great task!", taskid: taskId, authorid: bobId });
    await k.insert("comments", { content: "I agree.", taskid: taskId, authorid: aliceId });
    
    console.log("✅ Data inserted.");

    // 5. Run Nested Query
    console.log("\n3. Running Nested Query: tasks -> comments -> author");
    const result = await k.data({
      tasks: {
        where: { id: taskId },
        comments: {
          author: true
        }
      }
    }, { debug: true });

    console.log("\n--- Results ---");
    console.log("Generated SQL:\n", result.sql);
    console.log("\nNormalized Data:\n", JSON.stringify(result.data, null, 2));

    // 6. Verification
    const task = result.data[0];
    if (
      task && 
      task.id === taskId &&
      task.comments.length === 2 && 
      task.comments[0].author.id !== undefined
    ) {
      console.log("\n✅ Success: Nested data is correct and normalized.");
    } else {
      console.log("\n❌ Failure: Data mismatch in result.");
    }

  } catch (e: any) {
    console.error("\n❌ Test Failed:", e.message);
  } finally {
    await db.close();
  }
}

runRealTest();

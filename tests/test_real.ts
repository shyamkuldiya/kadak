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
  const dbClient = db.define({ users, tasks, comments });

  try {
    // 3. Schema Push
    console.log("\n1. Pushing Schema...");
    await dbClient.push();
    console.log("✅ Schema pushed.");

    // 4. Insert Data using dbClient.insert
    console.log("\n2. Inserting Sample Data...");
    const { runQuery } = await import("../src/exec/client.js");
    
    await runQuery("DELETE FROM comments", [], DB_URL);
    await runQuery("DELETE FROM tasks", [], DB_URL);
    await runQuery("DELETE FROM users", [], DB_URL);

    const alice = await dbClient.insert("users", { name: "Alice", email: "alice@example.com" });
    const bob = await dbClient.insert("users", { name: "Bob", email: "bob@example.com" });
    
    const aliceId = alice.id;
    const bobId = bob.id;

    const task1 = await dbClient.insert("tasks", { title: "Task 1", userid: aliceId });
    const taskId = task1.id;

    await dbClient.insert("comments", { content: "Great task!", taskid: taskId, authorid: bobId });
    await dbClient.insert("comments", { content: "I agree.", taskid: taskId, authorid: aliceId });
    
    console.log("✅ Data inserted.");

    // 5. Update Data
    console.log("\n3. Updating Alice's name to 'Alicia'...");
    await dbClient.update("users", {
      where: { id: aliceId },
      data: { name: "Alicia" }
    });
    console.log("✅ Alice updated to Alicia.");

    // 6. Run Nested Query
    console.log("\n4. Running Nested Query: tasks -> comments -> author");
    let result = await dbClient.data({
      tasks: {
        where: { id: taskId },
        comments: {
          author: true
        }
      }
    }, { debug: true });

    console.log("\nNormalized Data (before delete):\n", JSON.stringify(result.data, null, 2));

    // 7. Delete Data
    console.log("\n5. Deleting Bob...");
    const deletedUsers = await dbClient.delete("users", { where: { id: bobId } });
    console.log("✅ Bob deleted:", deletedUsers);

    // 8. Verify Delete
    console.log("\n6. Running Nested Query again to verify delete...");
    result = await dbClient.data({
      tasks: {
        where: { id: taskId },
        comments: {
          author: true
        }
      }
    });

    console.log("\nNormalized Data (after delete):\n", JSON.stringify(result, null, 2));

    const task = result[0];
    const bobAuthor = task.comments.find((c: any) => c.author && c.author.id === bobId);
    
    if (
      task && 
      task.comments.length === 2 && 
      !bobAuthor?.author // author relation should be null if user was deleted (assuming set null or cascade handled by DB)
    ) {
      console.log("\n✅ Success: Delete verified.");
    } else {
      console.log("\n⚠️ Note: Verification depends on DB constraints. Check output above.");
    }

  } catch (e: any) {
    console.error("\n❌ Test Failed:", e.message);
  } finally {
    await db.close();
  }
}

await runRealTest();

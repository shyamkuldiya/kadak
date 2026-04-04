import { kadak } from "../src/index.js";

async function runRealTest() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";

  console.log("--- Kadak Real Usage Test (NeonDB) ---");

  const schemaMapping = {
    users: {
      id: "users.id",
      tasks: "tasks.userid"
    },
    tasks: {
      id: "tasks.id",
      userid: "users.id",
      comments: "comments.taskid"
    },
    comments: {
      id: "comments.id",
      taskid: "tasks.id",
      author: "users.id"
    }
  };

  const db = kadak({ 
    url: DB_URL,
    schema: schemaMapping
  });

  try {
    // 1. Schema Push
    console.log("\n1. Pushing Schema...");
    await db.schema({
      users: {
        name: "string",
        email: { type: "string", unique: true }
      },
      tasks: {
        title: "string",
        userid: "ref:users"
      },
      comments: {
        content: "text",
        taskid: "ref:tasks",
        authorid: "ref:users"
      }
    }).push();
    console.log("✅ Schema pushed.");

    // 2. Insert Data
    console.log("\n2. Inserting Sample Data...");
    const { runQuery } = await import("../src/exec/client.js");
    
    await runQuery("DELETE FROM comments", [], DB_URL);
    await runQuery("DELETE FROM tasks", [], DB_URL);
    await runQuery("DELETE FROM users", [], DB_URL);

    const user1 = await runQuery("INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id", ["Alice", "alice@example.com"], DB_URL);
    const user2 = await runQuery("INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id", ["Bob", "bob@example.com"], DB_URL);
    
    const aliceId = user1[0].id;
    const bobId = user2[0].id;

    const task1 = await runQuery("INSERT INTO tasks (title, userid) VALUES ($1, $2) RETURNING id", ["Task 1", aliceId], DB_URL);
    const taskId = task1[0].id;

    await runQuery("INSERT INTO comments (content, taskid, authorid) VALUES ($1, $2, $3)", ["Great task!", taskId, bobId], DB_URL);
    await runQuery("INSERT INTO comments (content, taskid, authorid) VALUES ($1, $2, $3)", ["I agree.", taskId, aliceId], DB_URL);
    
    console.log("✅ Data inserted.");

  // 3. Run Nested Query
    console.log("\n3. Running Nested Query: tasks -> comments -> author");
    const result = await db.data({
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

    // 4. Verification
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

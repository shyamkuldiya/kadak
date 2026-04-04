import { kadak } from "../src/index.js";

async function runStressTest() {
  const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";

  console.log("--- Kadak Stress & Edge Case Test ---");

  const db = kadak({ 
    url: DB_URL
  });

  const schemaDef = {
    users: {
      name: "string",
      email: "string",
      tasks: "tasks.userid"
    },
    tasks: {
      title: "string",
      userid: "ref:users",
      comments: "comments.taskid"
    },
    comments: {
      content: "text",
      taskid: "ref:tasks",
      authorid: "ref:users",
      author: "users.id"
    }
  };

  try {
    console.log("1. Setting up schema...");
    await db.schema(schemaDef).push();

    const { runQuery } = await import("../src/exec/client.js");
    await runQuery("DELETE FROM comments", [], DB_URL);
    await runQuery("DELETE FROM tasks", [], DB_URL);
    await runQuery("DELETE FROM users", [], DB_URL);

    console.log("2. Seeding data...");
    const userIds: any[] = [];
    for (let i = 1; i <= 5; i++) {
      const res = await runQuery("INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id", [`User ${i}`, `user${i}@test.com`], DB_URL);
      userIds.push(res[0].id);
    }

    const taskIds: any[] = [];
    for (let i = 1; i <= 15; i++) {
      const authorId = userIds[i % 5];
      const res = await runQuery("INSERT INTO tasks (title, userid) VALUES ($1, $2) RETURNING id", [`Task ${i}`, authorId], DB_URL);
      taskIds.push(res[0].id);
    }

    for (let i = 0; i < 10; i++) {
      for (let j = 1; j <= 5; j++) {
        const commenterId = userIds[(i + j) % 5];
        await runQuery("INSERT INTO comments (content, taskid, authorid) VALUES ($1, $2, $3)", [`Comment ${j} for Task ${i+1}`, taskIds[i], commenterId], DB_URL);
      }
    }

    await runQuery("INSERT INTO comments (content, taskid, authorid) VALUES ($1, $2, $3)", ["Ghost comment", taskIds[14], null], DB_URL);

    console.log("✅ Data seeded.");

    console.log("\n3. Running Deep Query: tasks -> comments -> author");
    const result = await db.data({
      tasks: {
        comments: {
          author: true
        }
      }
    }, { debug: true });

    console.log(`\nResults returned: ${result.data.length} tasks.`);
    
    // verification...
    const resultData = result.data;
    const taskWithMany = resultData.find((t: any) => t.comments && t.comments.length === 5);
    const taskWithNone = resultData.find((t: any) => t.id === taskIds[10]); 
    const taskWithNullAuthor = resultData.find((t: any) => t.id === taskIds[14]);

    console.log("\n--- Edge Case Verification ---");
    console.log("Task with 5 comments found:", !!taskWithMany ? "✅ Yes" : "❌ No");
    console.log("Task with 0 comments found:", taskWithNone && taskWithNone.comments.length === 0 ? "✅ Passed" : "❌ Failed");
    
    const ghostComment = taskWithNullAuthor?.comments.find((c: any) => c.content === "Ghost comment");
    console.log("Comment with NULL author:", (ghostComment && ghostComment.author === null) ? "✅ Passed (null)" : "❌ Failed");

    // 4. Empty Result Set Edge Case
    console.log("\n4. Empty Result Set Test:");
    const emptyResult = await db.data({
      tasks: {
        where: { id: 999999 }
      }
    });
    console.log("Empty result count:", emptyResult.length);
    console.log("Empty result check:", emptyResult.length === 0 ? "✅ Passed" : "❌ Failed");

    console.log("\n--- ALL STRESS TESTS COMPLETED ---");

  } catch (e: any) {
    console.error("\n❌ Stress Test Failed:", e.message);
  } finally {
    await db.close();
  }
}

runStressTest();

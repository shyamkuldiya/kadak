import { kadak, buildAST } from "../src/index.js";
import { normalize } from "../src/exec/normalize.js";

async function runTests() {
  console.log("--- Kadak Integration & Normalization Tests ---");

  const tasks = kadak.table({
    name: "tasks",
    columns: { 
      id: "tasks.id",
      title: "tasks.title",
      user: "users.id",
      comments: "comments.task_id"
    }
  });

  const comments = kadak.table({
    name: "comments",
    columns: {
      id: "comments.id",
      content: "comments.content",
      author: "users.id"
    }
  });

  const users = kadak.table({
    name: "users",
    columns: {
      id: "users.id",
      name: "users.name"
    }
  });

  const db = kadak({ 
    url: "postgres://localhost:5432/mock"
  });

  const dbClient = db.define({ tasks, comments, users });

  // 1. Simple query
  console.log("\n1. Simple Query Test:");
  const q1 = await dbClient.data({ tasks: { user: true } }, { debug: true });
  console.log("SQL:", q1.sql);

  // 2. Nested query
  console.log("\n2. Nested Query Test:");
  const q2 = await dbClient.data({
    tasks: {
      comments: {
        author: true
      }
    }
  }, { debug: true });
  console.log("SQL:", q2.sql);

  // 3. Where query
  console.log("\n3. Where Query Test:");
  const q3 = await dbClient.data({
    tasks: {
      where: { id: 1 }
    }
  }, { debug: true });
  console.log("SQL:", q3.sql);
  console.log("Values:", q3.values);

  // 4. Normalization Correctness Test (Mock Data)
  console.log("\n4. Normalization Correctness Test:");
  const mockAST = buildAST({
    tasks: {
      comments: {
        author: true
      }
    }
  });
  const mockRows = [
    { 
      tasks__id: 1, tasks__title: "Task 1", 
      comments__id: 101, comments__content: "Comment 1", 
      author__id: 50, author__name: "Alice" 
    },
    { 
      tasks__id: 1, tasks__title: "Task 1", 
      comments__id: 102, comments__content: "Comment 2", 
      author__id: 60, author__name: "Bob" 
    }
  ];
  // Internal schema mapping for normalization
  const schemaMapping = {
    tasks: { comments: "comments.task_id" },
    comments: { author: "users.id" }
  };
  const normalized = normalize(mockRows, mockAST, schemaMapping);
  console.log("Normalized Output:", JSON.stringify(normalized, null, 2));

  if (normalized.length === 1 && normalized[0].comments.length === 2 && normalized[0].comments[0].author.id === 50) {
    console.log("✅ Success: Normalization is correct.");
  } else {
    console.log("❌ Failure: Normalization mismatch.");
  }

  await db.close().catch(() => {});
}

await runTests();

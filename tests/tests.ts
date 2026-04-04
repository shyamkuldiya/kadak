import { kadak, buildAST } from "../src/index.js";
import { normalize } from "../src/exec/normalize.js";

async function runTests() {
  console.log("--- Kadak Integration & Normalization Tests ---");

  const schema = {
    tasks: { 
      user: "users.id",
      comments: "comments.task_id"
    },
    comments: {
      author: "users.id"
    },
    users: {}
  };

  const db = kadak({ 
    url: "postgres://localhost:5432/mock", 
    schema 
  });

  // 1. Simple query
  console.log("\n1. Simple Query Test:");
  const q1 = await db.data({ tasks: { user: true } }, { debug: true });
  console.log("SQL:", q1.sql);
  console.log("Data (empty mock):", q1.data);

  // 2. Nested query
  console.log("\n2. Nested Query Test:");
  const q2 = await db.data({
    tasks: {
      comments: {
        author: true
      }
    }
  }, { debug: true });
  console.log("SQL:", q2.sql);

  // 3. Where query
  console.log("\n3. Where Query Test:");
  const q3 = await db.data({
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
      id: 1, title: "Task 1", 
      comments_id: 101, comments_content: "Comment 1", 
      author_id: 50, author_name: "Alice" 
    },
    { 
      id: 1, title: "Task 1", 
      comments_id: 102, comments_content: "Comment 2", 
      author_id: 60, author_name: "Bob" 
    }
  ];
  const normalized = normalize(mockRows, mockAST, schema);
  console.log("Normalized Output:", JSON.stringify(normalized, null, 2));

  if (normalized.length === 1 && normalized[0].comments.length === 2 && normalized[0].comments[0].author.id === 50) {
    console.log("✅ Success: Normalization is correct.");
  } else {
    console.log("❌ Failure: Normalization mismatch.");
  }

  await db.close().catch(() => {});
}

runTests();

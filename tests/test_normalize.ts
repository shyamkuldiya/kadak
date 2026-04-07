import { normalize } from "../src/exec/normalize.js";

async function runTests() {
  console.log("--- Normalization Layer Fix Tests ---");

  // Schema: 
  // tasks.user -> users.id (One-to-One)
  // tasks.comments -> comments.task_id (One-to-Many)
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

  const ast = {
    root: "tasks",
    relations: [
      { name: "user", relations: [] },
      { 
        name: "comments", 
        relations: [
          { name: "author", relations: [] }
        ] 
      }
    ]
  };

  // Mock flat rows
  const rows = [
    { 
      id: 1, title: "Task 1", 
      user_id: 10, user_name: "Alice",
      comments_id: 1, comments_content: "Great", 
      author_id: 20, author_name: "Bob" 
    },
    { 
      id: 1, title: "Task 1", 
      user_id: 10, user_name: "Alice",
      comments_id: 2, comments_content: "Cool", 
      author_id: 30, author_name: "Charlie" 
    }
  ];

  console.log("\n1. Mixed Cardinality Normalization:");
  const result = normalize(rows, ast as any, schema);
  console.log(JSON.stringify(result, null, 2));

  // Verify: 'user' should be an object, 'comments' should be an array.
  const task = result[0];
  const isUserObject = task.user && !Array.isArray(task.user);
  const isCommentsArray = Array.isArray(task.comments);

  if (isUserObject && isCommentsArray && task.comments.length === 2) {
    console.log("✅ Success: correctly returned object for 1:1 and array for 1:N.");
  } else {
    console.log("❌ Failure: Cardinality mismatch.");
    if (!isUserObject) console.log("   - 'user' is not an object.");
    if (!isCommentsArray) console.log("   - 'comments' is not an array.");
  }
}

await runTests();

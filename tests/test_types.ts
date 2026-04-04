import { kadak } from "../src/index.js";

/**
 * THIS IS A TYPE-ONLY TEST
 * Open this file in Antigravity IDE to see autocomplete in action.
 */

async function testAutocomplete() {
  const db = kadak({ url: "postgres://localhost:5432/db" });

  // 1. Define schema
  // The 'as const' is important for TypeScript to infer literal types!
  const mySchema = {
    users: {
      name: "string",
      posts: "ref:posts"
    },
    posts: {
      title: "string",
      author: "ref:users",
      comments: "ref:comments"
    },
    comments: {
      content: "text",
      post: "ref:posts",
      author: "ref:users"
    }
  } as const;

  // 2. Initialize typed instance
  const typedDb = db.schema(mySchema);

  // 3. Autocomplete Check
  // Try typing 'typedDb.data({ ' below and see suggestions for 'users', 'posts', 'comments'
  await typedDb.data({
    users: {
      where: { id: 1 },
      posts: {
        comments: {
          author: true
        }
      }
    }
  });

  console.log("✅ Types are strictly inferred. Autocomplete is enabled.");
  await db.close().catch(() => {});
}

testAutocomplete();

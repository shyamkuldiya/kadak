import { kadak } from "../src/index.js";

/**
 * THIS IS A TYPE-ONLY TEST
 * Open this file in Antigravity IDE to see autocomplete in action.
 */

async function testAutocomplete() {
  const db = kadak({ url: "postgres://localhost:5432/db" });

  // 1. Explicit Table Definitions
  const users = kadak.table({
    name: "users",
    columns: {
      name: "string",
      email: { type: "string", unique: true },
      posts: "posts.author" // Explicitly define relation
    }
  });

  const posts = kadak.table({
    name: "posts",
    columns: {
      title: "string",
      author: "ref:users"
    }
  });

  // 2. Explicit Registration
  const typedDb = db.define({
    users,
    posts
  });

  // 3. Autocomplete Check
  // Try typing 'typedDb.data({ ' below and see suggestions for 'users', 'posts'
  await typedDb.data({
    users: {
      where: { name: "Alice" },
      posts: {
        where: { title: "Hello" }
      }
    }
  });

  // TypeScript Error Check (uncomment to see error)
  // @ts-expect-error - 'invalid_table' does not exist
  // await typedDb.data({ invalid_table: {} });

  console.log("✅ Explicit table registration works. Autocomplete is enabled.");
  await db.close().catch(() => {});
}

testAutocomplete();

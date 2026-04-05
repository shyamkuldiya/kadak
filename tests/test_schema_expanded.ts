import { kadak } from "../src/index.js";
import { buildSchemaSQL } from "../src/schema/migrator.js";

async function runTests() {
  console.log("--- Kadak Expanded Schema Tests ---");

  const users = kadak.table({
    name: "users",
    columns: {
      email: { type: "string", unique: true },
      name: { type: "varchar", length: 100, nullable: false },
      age: "int",
      role: { type: "string", default: "user" }
    }
  });

  const posts = kadak.table({
    name: "posts",
    columns: {
      title: "string",
      content: "text",
      authorId: { ref: "users", onDelete: "cascade", index: true },
      metadata: "jsonb"
    }
  });

  console.log("\n1. Verify Expanded SQL Generation:");
  const schemaDef = {
    users: users.config.columns,
    posts: posts.config.columns
  };
  const sqls = buildSchemaSQL(schemaDef);
  sqls.forEach(sql => console.log(sql));

  // Verification helper: remove quotes and normalize whitespace for comparison
  const clean = (s: string) => s.replace(/"/g, "").replace(/\s+/g, " ");

  const userSql = sqls.find(s => s.includes("CREATE TABLE IF NOT EXISTS users"));
  const postSql = sqls.find(s => s.includes("CREATE TABLE IF NOT EXISTS posts"));
  const indexSql = sqls.find(s => s.includes("CREATE INDEX IF NOT EXISTS idx_posts_authorId"));

  const results = [
    { name: "Users Table", pass: !!userSql && clean(userSql).includes("email VARCHAR(255) UNIQUE") },
    { name: "Users Name (length/nullable)", pass: !!userSql && clean(userSql).includes("name VARCHAR(100) NOT NULL") },
    { name: "Users Role (default)", pass: !!userSql && clean(userSql).includes("role VARCHAR(255) DEFAULT 'user'") },
    { name: "Posts FK (onDelete)", pass: !!postSql && clean(postSql).includes("REFERENCES users(id) ON DELETE CASCADE") },
    { name: "Posts Index", pass: !!indexSql },
    { name: "Posts Metadata (jsonb)", pass: !!postSql && clean(postSql).includes("metadata JSONB") }
  ];

  results.forEach(res => {
    console.log(`${res.pass ? "✅" : "❌"} ${res.name}`);
  });

  if (results.every(r => r.pass)) {
    console.log("\n✅ All Expanded Schema Tests Passed!");
  } else {
    console.log("\n❌ Some tests failed.");
  }
}

runTests();

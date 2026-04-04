import { buildSchemaSQL } from "../src/schema/migrator.js";

async function runTests() {
  console.log("--- Kadak Expanded Schema Tests ---");

  const schemaDef = {
    users: {
      email: { type: "string", unique: true },
      name: { type: "varchar", length: 100, nullable: false },
      age: "int",
      role: { type: "string", default: "user" }
    },
    posts: {
      title: "string",
      content: "text",
      authorId: { ref: "users", onDelete: "cascade", index: true },
      metadata: "jsonb"
    }
  };

  console.log("\n1. Verify Expanded SQL Generation:");
  const sqls = buildSchemaSQL(schemaDef as any);
  sqls.forEach(sql => console.log(sql));

  // Verification
  const userSql = sqls.find(s => s.includes("CREATE TABLE IF NOT EXISTS users"));
  const postSql = sqls.find(s => s.includes("CREATE TABLE IF NOT EXISTS posts"));
  const indexSql = sqls.find(s => s.includes("CREATE INDEX IF NOT EXISTS idx_posts_authorId"));

  const results = [
    { name: "Users Table", pass: !!userSql && userSql.includes("email VARCHAR(255) UNIQUE") },
    { name: "Users Name (length/nullable)", pass: !!userSql && userSql.includes("name VARCHAR(100) NOT NULL") },
    { name: "Users Role (default)", pass: !!userSql && userSql.includes("role VARCHAR(255) DEFAULT 'user'") },
    { name: "Posts FK (onDelete)", pass: !!postSql && postSql.includes("REFERENCES users(id) ON DELETE CASCADE") },
    { name: "Posts Index", pass: !!indexSql },
    { name: "Posts Metadata (jsonb)", pass: !!postSql && postSql.includes("metadata JSONB") }
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

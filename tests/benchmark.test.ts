import { describe, expect, it } from "vitest";
import { kadak } from "../src/index.js";
import { runQuery } from "../src/exec/client.js";

const DB_URL = process.env.DATABASE_URL;
const canRun = Boolean(DB_URL);

const suite = canRun ? describe : describe.skip;

suite("query benchmark", () => {
  const db = kadak({ url: DB_URL! });
  const users = kadak.table({
    name: "users",
    columns: {
      name: "string",
      posts: "posts.authorId"
    }
  });
  const posts = kadak.table({
    name: "posts",
    columns: {
      title: "string",
      authorId: kadak.types.ref("users", { as: "author" }),
      comments: "comments.postId"
    }
  });
  const comments = kadak.table({
    name: "comments",
    columns: {
      content: "text",
      postId: kadak.types.ref("posts", { as: "post" })
    }
  });

  const dbClient = db.define({ users, posts, comments });

  it("logs optimized relation count latency improvement", async () => {
    const optimized = dbClient.data({
      posts: {
        comments: {
          _count: true
        }
      }
    });

    const optimizedSql = optimized.toSQL().sql;
    const t1 = performance.now();
    await optimized;
    const optimizedMs = performance.now() - t1;

    const fallbackSql = optimizedSql
      .replace(/LEFT JOIN \(\s*SELECT "post_id" AS "__kadak_fk", COUNT\(\*\) AS "__kadak_count"\s*FROM comments\s*GROUP BY "post_id"\s*\) comments__count_join ON comments__count_join\."__kadak_fk" = posts\."id"/s,
        "(SELECT COUNT(*) FROM comments WHERE comments.\"post_id\" = posts.\"id\") AS \"comments__count\"");

    const t2 = performance.now();
    await runQuery(fallbackSql, [], DB_URL!);
    const fallbackMs = performance.now() - t2;

    const improvement = fallbackMs > 0 ? ((fallbackMs - optimizedMs) / fallbackMs) * 100 : 0;
    console.log(`[Kadak Benchmark] optimized=${optimizedMs.toFixed(2)}ms fallback=${fallbackMs.toFixed(2)}ms improvement=${improvement.toFixed(1)}%`);
    expect(Number.isFinite(improvement)).toBe(true);
  }, 120000);
});

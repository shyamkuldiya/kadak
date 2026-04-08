import { describe, expect, it } from "vitest";
import { kadak } from "../src/index.js";

describe("count support", () => {
  const db = kadak({ url: "postgres://localhost:5432/mock" });
  const posts = kadak.table({
    name: "posts",
    columns: {
      title: "string"
    }
  });
  const dbClient = db.define({ posts });

  it("builds root count SQL", () => {
    const q = dbClient.data({
      posts: {
        _count: true
      }
    });

    expect(q.toSQL().sql).toContain("SELECT COUNT(*) AS \"_count\" FROM posts");
  });

  it("respects where in count SQL", () => {
    const q = dbClient.data({
      posts: {
        _count: true,
        where: { title: "Hello" }
      }
    });

    const sql = q.toSQL().sql;
    expect(sql).toContain("SELECT COUNT(*) AS \"_count\" FROM posts");
    expect(sql).toContain('WHERE posts."title" = $1');
  });

  it("allows _count to coexist with select", () => {
    const q = dbClient.data({
      posts: {
        _count: true,
        select: {
          title: true
        }
      }
    });

    expect(q.toSQL().sql).toContain("SELECT COUNT(*) AS \"_count\" FROM posts");
  });

  it("returns root keyed _count shape", async () => {
    const q = dbClient.data({
      posts: {
        _count: true
      }
    });

    const result = await q;
    expect(result).toHaveProperty("posts");
    expect(result.posts).toHaveProperty("_count");
  });
});

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
        count: true
      }
    });

    expect(q.toSQL().sql).toContain("SELECT COUNT(*) AS \"count\" FROM posts");
  });

  it("respects where in count SQL", () => {
    const q = dbClient.data({
      posts: {
        count: true,
        where: { title: "Hello" }
      }
    });

    const sql = q.toSQL().sql;
    expect(sql).toContain("SELECT COUNT(*) AS \"count\" FROM posts");
    expect(sql).toContain('WHERE posts."title" = $1');
  });

  it("throws when count is mixed with select", () => {
    expect(() => dbClient.data({
      posts: {
        count: true,
        select: {
          title: true
        }
      }
    })).toThrow("Kadak Error: count cannot be mixed with select, relations, or ordering");
  });
});

import { describe, expect, it } from "vitest";
import { kadak } from "../src/index.js";
import { normalize } from "../src/exec/normalize.js";

describe("relation count support", () => {
  const db = kadak({ url: "postgres://localhost:5432/mock" });
  const posts = kadak.table({
    name: "posts",
    columns: {
      title: "string",
      comments: "comments.post_id"
    }
  });
  const comments = kadak.table({
    name: "comments",
    columns: {
      content: "string",
      post_id: "int"
    }
  });
  const dbClient = db.define({ posts, comments });

  it("uses a correlated subquery for relation count", () => {
    const q = dbClient.data({
      posts: {
        comments: {
          _count: true
        }
      }
    });

    const sql = q.toSQL().sql;
    expect(sql).toContain('SELECT posts.id AS "posts__id"');
    expect(sql).toContain('SELECT COUNT(*)');
    expect(sql).toContain('FROM comments');
    expect(sql).toContain('WHERE comments."post_id" = posts."id"');
    expect(sql).not.toContain("LEFT JOIN comments");
  });

  it("normalizes relation count into nested object", () => {
    const ast = {
      root: "posts",
      relations: [
        {
          name: "comments",
          _count: true,
          relations: []
        }
      ]
    } as any;

    const rows = [
      {
        posts__id: 1,
        posts__title: "First",
        comments__count: 2
      }
    ];

    const result = normalize(rows, ast, {
      posts: { comments: "comments.post_id" },
      comments: {}
    } as any);

    expect(result).toEqual([
      {
        id: 1,
        title: "First",
        comments: {
          _count: 2
        }
      }
    ]);
  });

  it("returns zero when no related rows exist", () => {
    const ast = {
      root: "posts",
      relations: [
        {
          name: "comments",
          _count: true,
          relations: []
        }
      ]
    } as any;

    const result = normalize([
      {
        posts__id: 1,
        comments__count: 0
      }
    ], ast, {
      posts: { comments: "comments.post_id" },
      comments: {}
    } as any);

    expect(result[0].comments._count).toBe(0);
  });

  it("throws when _count is mixed with fields", () => {
    expect(() => dbClient.data({
      posts: {
        comments: {
          _count: true,
          select: {
            content: true
          }
        }
      }
    })).toThrow("Kadak Error: _count cannot be combined with fields or nested relations");
  });
});

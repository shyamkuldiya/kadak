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
    expect(sql).toContain('LEFT JOIN (');
    expect(sql).toContain('SELECT "post_id" AS "__kadak_fk", COUNT(*) AS "__kadak_count"');
    expect(sql).toContain('COALESCE(comments__count_join."__kadak_count", 0) AS "comments__count"');
    expect(sql).not.toContain('LEFT JOIN comments ON');
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

  it("allows _count to coexist with fields", () => {
    const sql = dbClient.data({
      posts: {
        title: true,
        comments: {
          _count: true
        }
      }
    }).toSQL().sql;

    expect(sql).toContain('posts."title" AS "posts__title"');
    expect(sql).toContain('COALESCE(comments__count_join."__kadak_count", 0) AS "comments__count"');
  });

  it("allows _count to coexist with nested relations", () => {
    const db3 = kadak({ url: "postgres://localhost:5432/mock" });
    const users = kadak.table({
      name: "users",
      columns: {
        name: "string"
      }
    });
    const posts3 = kadak.table({
      name: "posts",
      columns: {
        title: "string",
        authorId: kadak.types.ref("users", { as: "author" }),
        comments: "comments.postId"
      }
    });
    const comments3 = kadak.table({
      name: "comments",
      columns: {
        content: "string",
        postId: kadak.types.ref("posts", { as: "post" }),
        authorId: kadak.types.ref("users", { as: "author" })
      }
    });
    const client = db3.define({ users, posts: posts3, comments: comments3 });

    const sql = client.data({
      posts: {
        comments: {
          _count: true,
          author: {
            select: {
              name: true
            }
          }
        }
      }
    }).toSQL().sql;

    expect(sql).toContain('COALESCE(comments__count_join."__kadak_count", 0) AS "comments__count"');
    expect(sql).toContain('LEFT JOIN users author ON comments."authorId" = author."id"');
  });

  it("supports multiple relations with _count", () => {
    const db3 = kadak({ url: "postgres://localhost:5432/mock" });
    const users = kadak.table({
      name: "users",
      columns: {
        name: "string"
      }
    });
    const posts3 = kadak.table({
      name: "posts",
      columns: {
        title: "string",
        authorId: kadak.types.ref("users", { as: "author" }),
        comments: "comments.postId"
      }
    });
    const comments3 = kadak.table({
      name: "comments",
      columns: {
        content: "string",
        postId: kadak.types.ref("posts", { as: "post" })
      }
    });
    const client = db3.define({ users, posts: posts3, comments: comments3 });

    const sql = client.data({
      posts: {
        comments: {
          _count: true
        },
        author: {
          select: {
            name: true
          }
        }
      }
    }).toSQL().sql;

    expect(sql).toContain('COALESCE(comments__count_join."__kadak_count", 0) AS "comments__count"');
    expect(sql).toContain('LEFT JOIN users author ON posts."authorId" = author."id"');
  });

  it("supports custom foreign key names from schema mapping", () => {
    const db2 = kadak({ url: "postgres://localhost:5432/mock" });
    const users = kadak.table({
      name: "users",
      columns: {
        name: "string",
        posts: "posts.authorRef"
      }
    });
    const posts2 = kadak.table({
      name: "posts",
      columns: {
        title: "string",
        authorRef: kadak.types.ref("users", { as: "author" })
      }
    });
    const client = db2.define({ users, posts: posts2 });

    const q = client.data({
      users: {
        posts: {
          _count: true
        }
      }
    });

    const sql = q.toSQL().sql;
    expect(sql).toContain('SELECT "authorRef" AS "__kadak_fk", COUNT(*) AS "__kadak_count"');
    expect(sql).toContain('posts__count_join ON posts__count_join."__kadak_fk" = users."id"');
    expect(sql).not.toContain('post_id');
  });
});

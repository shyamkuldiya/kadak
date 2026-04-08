import { describe, expect, it } from "vitest";
import { kadak } from "../src/index.js";
import { normalize } from "../src/exec/normalize.js";

describe("select support", () => {
  const db = kadak({ url: "postgres://localhost:5432/mock" });
  const users = kadak.table({
    name: "users",
    columns: {
      name: "string"
    }
  });
  const posts = kadak.table({
    name: "posts",
    columns: {
      title: "string",
      authorId: kadak.types.ref("users", { as: "author" })
    }
  });
  const dbClient = db.define({ users, posts });

  it("supports root select", () => {
    const q = dbClient.data({
      users: {
        select: {
          id: true,
          name: true
        }
      }
    });

    const sql = q.toSQL().sql;
    expect(sql).toContain('SELECT users.id AS "users__id", users."name" AS "users__name" FROM users');
  });

  it("supports nested select", () => {
    const q = dbClient.data({
      posts: {
        select: {
          id: true,
          title: true
        },
        author: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    const sql = q.toSQL().sql;
    expect(sql).toContain('SELECT posts.id AS "posts__id", posts."title" AS "posts__title", author.id AS "author_id", author."name" AS "author_name" FROM posts');
    expect(sql).toContain('LEFT JOIN users author ON posts."authorId" = author."id"');
  });

  it("throws on invalid select field", () => {
    expect(() => dbClient.data({
      users: {
        select: {
          id: true,
          missing: true
        }
      }
    })).toThrow("Kadak Error: invalid field 'missing' on 'users'");
  });

  it("normalizes partial rows", () => {
    const ast = {
      root: "posts",
      select: { id: true, title: true },
      relations: [
        {
          name: "author",
          select: { id: true, name: true },
          relations: []
        }
      ]
    } as any;

    const rows = [
      {
        posts__id: 1,
        posts__title: "Hello",
        author_id: 2,
        author_name: "Ada"
      }
    ];

    const schema = {
      posts: { author: { table: "users", as: "author", to: "id", source: "authorId" } },
      users: {}
    };

    const result = normalize(rows, ast, schema as any);
    expect(result[0].title).toBe("Hello");
    expect(result[0].author.name).toBe("Ada");
    expect(result[0]).not.toHaveProperty("author_id");
    expect(result[0]).not.toHaveProperty("author_email");
  });

  it("keeps null relation null", () => {
    const ast = {
      root: "posts",
      select: { id: true, title: true },
      relations: [
        {
          name: "author",
          select: { email: true },
          relations: []
        }
      ]
    } as any;

    const rows = [
      {
        posts__id: 1,
        posts__title: "Hello",
        author_id: null,
        author_email: null
      }
    ];

    const schema = {
      posts: { author: { table: "users", as: "author", to: "id", source: "authorId" } },
      users: {}
    };

    const result = normalize(rows, ast, schema as any);
    expect(result[0].author).toBeNull();
  });

  it("does not leak relation conditions into WHERE", () => {
    const q = dbClient.data({
      posts: {
        where: {
          id: 1
        },
        author: {
          select: {
            name: true
          }
        }
      }
    });

    const sql = q.toSQL().sql;
    expect(sql).toContain('WHERE posts."id" = $1');
    expect(sql).toContain('LEFT JOIN users author ON posts."authorId" = author."id"');
    expect(sql).not.toContain('author."id" =');
    expect(sql).not.toContain('author."name" =');
  });
});

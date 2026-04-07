import { describe, expect, it } from "vitest";
import { kadak } from "../src/index.js";

describe("explicit ref()", () => {
  it("supports a basic relation and query name", () => {
    const db = kadak({ url: "postgres://localhost:5432/mock" });
    const users = kadak.table({ name: "users", columns: { id: "users.id" } });
    const posts = kadak.table({
      name: "posts",
      columns: {
        authorId: kadak.types.ref("users", { as: "author" })
      }
    });

    const dbClient = db.define({ users, posts });
    const sql = dbClient.data({ posts: { author: true } }).toSQL().sql;

    expect(sql).toContain('LEFT JOIN users author ON posts."authorId" = author."id"');
  });

  it("supports a custom target column", () => {
    const db = kadak({ url: "postgres://localhost:5432/mock" });
    const users = kadak.table({ name: "users", columns: { uuid: "text" } });
    const posts = kadak.table({
      name: "posts",
      columns: {
        authorId: kadak.types.ref("users", { as: "author", to: "uuid" })
      }
    });

    const dbClient = db.define({ users, posts });
    const sql = dbClient.data({ posts: { author: true } }).toSQL().sql;

    expect(sql).toContain('LEFT JOIN users author ON posts."authorId" = author."uuid"');
  });

  it("throws when as is missing", () => {
    expect(() => kadak.types.ref("users", {} as any)).toThrow("Kadak Error: 'as' is required in ref()");
  });

  it("throws on duplicate relation names", () => {
    const db = kadak({ url: "postgres://localhost:5432/mock" });
    const users = kadak.table({ name: "users", columns: { id: "users.id" } });
    const posts = kadak.table({
      name: "posts",
      columns: {
        authorId: kadak.types.ref("users", { as: "author" }),
        reviewerId: kadak.types.ref("users", { as: "author" })
      }
    });

    expect(() => db.define({ users, posts })).toThrow("Kadak Error: duplicate relation name 'author'");
  });

  it("throws when relation name conflicts with column", () => {
    const db = kadak({ url: "postgres://localhost:5432/mock" });
    const users = kadak.table({ name: "users", columns: { id: "users.id" } });
    const posts = kadak.table({
      name: "posts",
      columns: {
        author: "text",
        authorId: kadak.types.ref("users", { as: "author" })
      }
    });

    expect(() => db.define({ users, posts })).toThrow("Kadak Error: relation name 'author' conflicts with column");
  });
});

import { describe, expect, it } from "vitest";
import { kadak } from "../src/index.js";

describe("backRef support", () => {
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
      authorId: kadak.types.ref("users", { as: "author", backRef: "posts" })
    }
  });

  const dbClient = db.define({ users, posts });

  it("builds forward and reverse relations", () => {
    const forward = dbClient.data({
      posts: {
        author: true
      }
    }).toSQL().sql;

    const reverse = dbClient.data({
      users: {
        posts: true
      }
    }).toSQL().sql;

    expect(forward).toContain('LEFT JOIN users author ON posts."authorId" = author."id"');
    expect(reverse).toContain('LEFT JOIN posts ON users."id" = posts."authorId"');
  });

  it("supports nested reverse queries", () => {
    const sql = dbClient.data({
      users: {
        posts: {
          author: true
        }
      }
    }).toSQL().sql;

    expect(sql).toContain('LEFT JOIN posts ON users."id" = posts."authorId"');
    expect(sql).toContain('LEFT JOIN users author ON posts."authorId" = author."id"');
  });

  it("throws on reverse relation conflicts", () => {
    expect(() => {
      const badDb = kadak({ url: "postgres://localhost:5432/mock" });
      const badUsers = kadak.table({
        name: "users",
        columns: {
          name: "string",
          posts: "string"
        }
      });
      const badPosts = kadak.table({
        name: "posts",
        columns: {
          title: "string",
          authorId: kadak.types.ref("users", { as: "author", backRef: "posts" })
        }
      });
      badDb.define({ users: badUsers, posts: badPosts });
    }).toThrow("Kadak Error: relation name 'posts' conflicts with column");
  });
});

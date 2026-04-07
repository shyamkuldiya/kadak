import { describe, expect, it } from "vitest";
import { kadak } from "../src/index.js";

describe("pagination ordering requirement", () => {
  const db = kadak({ url: "postgres://localhost:5432/mock" });
  const posts = kadak.table({
    name: "posts",
    columns: {
      title: "string"
    }
  });
  const dbClient = db.define({ posts });

  it("throws when take is used without orderBy", () => {
    expect(() => dbClient.data({ posts: { take: 10 } } as any)).toThrow("Kadak Error: orderBy is required when using pagination");
  });

  it("throws when skip is used without orderBy", () => {
    expect(() => dbClient.data({ posts: { skip: 20 } } as any)).toThrow("Kadak Error: orderBy is required when using pagination");
  });

  it("supports take with orderBy", () => {
    const sql = dbClient.data({ posts: { take: 10, orderBy: { id: "desc" } } }).toSQL().sql;
    expect(sql).toContain("ORDER BY posts.\"id\" DESC");
    expect(sql).toContain("LIMIT 10");
  });

  it("supports skip with orderBy", () => {
    const sql = dbClient.data({ posts: { skip: 20, orderBy: { id: "desc" } } }).toSQL().sql;
    expect(sql).toContain("ORDER BY posts.\"id\" DESC");
    expect(sql).toContain("OFFSET 20");
  });
});

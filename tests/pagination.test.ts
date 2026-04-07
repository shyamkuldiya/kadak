import { describe, expect, it } from "vitest";
import { kadak } from "../src/index.js";

describe("pagination", () => {
  const db = kadak({ url: "postgres://localhost:5432/mock" });
  const posts = kadak.table({
    name: "posts",
    columns: {
      title: "string"
    }
  });
  const dbClient = db.define({ posts });

  it("supports take", () => {
    const sql = dbClient.data({ posts: { take: 10 } }).toSQL().sql;
    expect(sql).toContain("LIMIT 10");
  });

  it("supports skip", () => {
    const sql = dbClient.data({ posts: { skip: 20 } }).toSQL().sql;
    expect(sql).toContain("OFFSET 20");
  });

  it("supports take and skip", () => {
    const sql = dbClient.data({ posts: { take: 10, skip: 20 } }).toSQL().sql;
    expect(sql).toContain("LIMIT 10");
    expect(sql).toContain("OFFSET 20");
  });

  it("throws on invalid take", () => {
    expect(() => dbClient.data({ posts: { take: 0 } as any })).toThrow("Kadak Error: 'take' must be > 0");
  });

  it("throws on invalid skip", () => {
    expect(() => dbClient.data({ posts: { skip: -1 } as any })).toThrow("Kadak Error: 'skip' must be >= 0");
  });
});

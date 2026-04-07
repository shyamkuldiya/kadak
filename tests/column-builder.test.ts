import { describe, expect, it } from "vitest";
import { kadak } from "../src/index.js";
import { buildSchemaSQL, ColumnBuilder } from "../src/schema/migrator.js";

describe("column builder metadata", () => {
  it("stores string metadata", () => {
    const col = kadak.types.string().min(3).max(10).lowercase().build();
    expect(col.min).toBe(3);
    expect(col.max).toBe(10);
    expect(col.lowercase).toBe(true);
  });

  it("stores int metadata", () => {
    const col = kadak.types.int().min(1).max(99).build();
    expect(col.min).toBe(1);
    expect(col.max).toBe(99);
  });

  it("supports array string sql", () => {
    const users = kadak.table({
      name: "users",
      columns: {
        tags: kadak.types.array(kadak.types.string())
      }
    });

    const sql = buildSchemaSQL({ users: users.config.columns }).join("\n");
    expect(sql).toContain('"tags" TEXT[]');
  });

  it("supports array int sql", () => {
    const users = kadak.table({
      name: "users",
      columns: {
        scores: kadak.types.array(kadak.types.int())
      }
    });

    const sql = buildSchemaSQL({ users: users.config.columns }).join("\n");
    expect(sql).toContain('"scores" INTEGER[]');
  });

  it("preserves builder chaining", () => {
    const builder = kadak.types.string().min(1).max(5).lowercase();
    expect(builder).toBeInstanceOf(ColumnBuilder);
  });
});

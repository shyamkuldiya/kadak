import { ColumnDef, SchemaDef, CanonicalSchemaDef, CanonicalColumn, CanonicalRef } from "./types.js";

export function normalizeColumn(col: ColumnDef): CanonicalColumn | CanonicalRef {
  if (typeof col === "string") {
    switch (col) {
      case "string":
        return { type: "varchar", length: 255, nullable: false, unique: false };
      case "int":
        return { type: "int", nullable: false, unique: false };
      case "text":
        return { type: "text", nullable: false, unique: false };
      case "jsonb":
        return { type: "jsonb", nullable: false, unique: false };
      default:
        throw new Error(`Unknown string shorthand for type: ${col}`);
    }
  }

  if ("ref" in col) {
    return {
      refTable: col.ref,
      nullable: col.nullable ?? false,
      index: col.index ?? false,
      unique: col.unique ?? false,
      onDelete: col.onDelete,
    };
  }

  return {
    ...col,
    nullable: col.nullable ?? false,
    unique: col.unique ?? false,
  };
}

export function normalizeSchema(schema: SchemaDef): CanonicalSchemaDef {
  const canonical: CanonicalSchemaDef = {};
  for (const [tableName, tableDef] of Object.entries(schema)) {
    canonical[tableName] = {};
    for (const [colName, colDef] of Object.entries(tableDef)) {
      canonical[tableName][colName] = normalizeColumn(colDef);
    }
  }
  return canonical;
}

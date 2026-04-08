import pg from "pg";
import { QueryAST, RelationAST } from "../query/ast.js";
import { runQuery } from "./client.js";

type SchemaEntry = string | { table: string; as: string; to: string; source: string } | Record<string, unknown>;
type Schema = Record<string, Record<string, SchemaEntry>>;
type Row = Record<string, unknown>;

type MultiOptions = {
  client?: pg.PoolClient;
  debug?: boolean;
};

type RelationDefinition = {
  table: string;
  as: string;
  to: string;
  source: string;
};

function isRelationEntry(entry: SchemaEntry | undefined): entry is RelationDefinition {
  return !!entry && typeof entry === "object" && "table" in entry && "as" in entry && "to" in entry && "source" in entry;
}

function getBaseFields(tableSchema: Record<string, SchemaEntry>): string[] {
  return Object.keys(tableSchema).filter((field) => {
    const mapping = tableSchema[field];
    if (field === "id") return false;
    if (typeof mapping === "string" && mapping.includes(".")) return false;
    return !isRelationEntry(mapping);
  });
}

function quote(field: string): string {
  return `"${field}"`;
}

function buildSelectSql(
  tableName: string,
  selectFields: string[],
  whereField?: string,
  whereValues?: unknown[],
  orderBy?: { field: string; direction: "asc" | "desc" },
  take?: number,
  skip?: number
) {
  const fields = Array.from(new Set(["id", ...selectFields]));
  const values: unknown[] = [];
  const sqlFields = fields.map((field) => `${quote(field)}`);
  let sql = `SELECT ${sqlFields.join(", ")} FROM ${tableName}`;

  if (whereField && whereValues && whereValues.length > 0) {
    const placeholders = whereValues.map((_, idx) => {
      values.push(whereValues[idx]);
      return `$${idx + 1}`;
    });
    sql += ` WHERE ${quote(whereField)} IN (${placeholders.join(", ")})`;
  }

  if (orderBy) {
    sql += ` ORDER BY ${quote(orderBy.field)} ${orderBy.direction.toUpperCase()}`;
  }

  if (take !== undefined) {
    sql += ` LIMIT ${take}`;
  }

  if (skip !== undefined) {
    sql += ` OFFSET ${skip}`;
  }

  return { sql, values };
}

function buildCountSql(tableName: string, countField: string, whereField: string, whereValues: unknown[]) {
  const values: unknown[] = [];
  const placeholders = whereValues.map((value, idx) => {
    values.push(value);
    return `$${idx + 1}`;
  });
  const sql = `SELECT ${quote(countField)} AS "__kadak_fk", COUNT(*) AS "__kadak_count" FROM ${tableName} WHERE ${quote(countField)} IN (${placeholders.join(", ")}) GROUP BY ${quote(countField)}`;
  return { sql, values };
}

export function buildMultiRootSql(
  ast: QueryAST,
  schema: Schema
) {
  const rootSchema = schema[ast.root] || {};
  const rootFields = ast.select ? Object.keys(ast.select).filter((f) => f !== "id") : getBaseFields(rootSchema);
  return buildSelectSql(ast.root, rootFields, undefined, undefined, ast.orderBy, ast.take, ast.skip);
}

function getRelation(tableSchema: Record<string, SchemaEntry>, relName: string): RelationDefinition | undefined {
  const entry = tableSchema[relName];
  if (isRelationEntry(entry)) return entry;
  if (typeof entry === "string" && entry.includes(".")) {
    const [table, to] = entry.split(".");
    return { table, as: relName, to: to || "id", source: "id" };
  }
  return undefined;
}

function shouldSelectId(select?: Record<string, true>) {
  return !select || !!select.id;
}

function projectRow(row: Row, select?: Record<string, true>) {
  const projected: Row = {};
  if (select) {
    for (const key of Object.keys(select)) {
      if (key in row) projected[key] = row[key];
    }
  } else {
    for (const [key, value] of Object.entries(row)) {
      if (key !== "id") projected[key] = value;
    }
  }
  return projected;
}

function maxDepth(relations: RelationAST[]): number {
  let depth = 0;
  for (const rel of relations) {
    depth = Math.max(depth, 1 + maxDepth(rel.relations));
  }
  return depth;
}

function hasReverseRelation(tableName: string, relations: RelationAST[], schema: Schema): boolean {
  const tableSchema = schema[tableName] || {};
  for (const rel of relations) {
    const mapping = getRelation(tableSchema, rel.name);
    if (!mapping) continue;
    if (mapping.source === "id" && mapping.to !== "id") return true;
    if (hasReverseRelation(mapping.table, rel.relations, schema)) return true;
  }
  return false;
}

function normalizeRoot(row: Row, select?: Record<string, true>) {
  const out: Row = {};
  if (row.id !== undefined && shouldSelectId(select)) out.id = row.id;
  for (const [key, value] of Object.entries(row)) {
    if (key === "id") continue;
    if (!select || select[key]) out[key] = value;
  }
  return out;
}

async function fetchMany(
  tableName: string,
  schema: Schema,
  whereField: string,
  whereValues: unknown[],
  select?: Record<string, true>,
  orderBy?: { field: string; direction: "asc" | "desc" },
  take?: number,
  skip?: number,
  client?: pg.PoolClient
) {
  const tableSchema = schema[tableName] || {};
  const baseFields = getBaseFields(tableSchema);
  const selectedFields = select ? Object.keys(select).filter((f) => f !== "id") : baseFields;
  const { sql, values } = buildSelectSql(tableName, selectedFields, whereField, whereValues, orderBy, take, skip);
  const rows = await runQuery(sql, values, undefined, client) as Row[];
  return rows.map((row) => normalizeRoot(row, select));
}

function collectValues(rows: Row[], field: string): unknown[] {
  const values = new Set<unknown>();
  for (const row of rows) {
    const value = row[field];
    if (value !== null && value !== undefined) values.add(value);
  }
  return Array.from(values);
}

async function hydrateRelations(
  tableName: string,
  rows: Row[],
  relations: RelationAST[],
  schema: Schema,
  options: MultiOptions,
  ancestry: string[] = []
): Promise<void> {
  const tableSchema = schema[tableName] || {};
  for (const rel of relations) {
    const relation = getRelation(tableSchema, rel.name);
    if (!relation || rows.length === 0) continue;

    const parentKeyField = relation.source;
    const childKeyField = relation.to || "id";
    const parentValues = collectValues(rows, parentKeyField);
    if (parentValues.length === 0) {
      for (const row of rows) {
        if (rel._count) {
          row[rel.name] = { _count: 0 };
        } else if (childKeyField === "id") {
          row[rel.name] = null;
        } else {
          row[rel.name] = [];
        }
      }
      continue;
    }

    if (rel._count && !rel.select && rel.relations.length === 0) {
      const { sql, values } = buildCountSql(relation.table, childKeyField, parentKeyField, parentValues);
      const countRows = await runQuery(sql, values, undefined, options.client) as Row[];
      const countMap = new Map<unknown, number>();
      for (const row of countRows) {
        const key = row.__kadak_fk;
        const raw = row.__kadak_count;
        countMap.set(key, typeof raw === "string" ? Number(raw) : Number(raw ?? 0));
      }
      for (const row of rows) {
        row[rel.name] = { _count: countMap.get(row[parentKeyField]) ?? 0 };
      }
      continue;
    }

    const childRows = await fetchMany(
      relation.table,
      schema,
      childKeyField,
      parentValues,
      rel.select,
      undefined,
      undefined,
      undefined,
      options.client
    );

    const nextAncestry = ancestry.concat(tableName);
    const isCycle = nextAncestry.includes(relation.table);
    if (!isCycle) {
      await hydrateRelations(relation.table, childRows, rel.relations, schema, options, nextAncestry);
    }

    if (childKeyField === "id") {
      const childMap = new Map<unknown, Row>();
      for (const child of childRows) {
        if (child.id !== undefined) childMap.set(child.id, child);
      }
      for (const row of rows) {
        row[rel.name] = childMap.get(row[parentKeyField]) ?? null;
      }
    } else {
      const groups = new Map<unknown, Row[]>();
      for (const child of childRows) {
        const key = (child as Row)[childKeyField];
        if (key === null || key === undefined) continue;
        const bucket = groups.get(key) || [];
        bucket.push(child);
        groups.set(key, bucket);
      }
      for (const row of rows) {
        row[rel.name] = groups.get(row[parentKeyField]) || [];
      }
    }

    if (rel._count) {
      const countValues = new Set<unknown>();
      for (const child of childRows) {
        const key = child[childKeyField];
        if (key !== null && key !== undefined) countValues.add(key);
      }
      const countMap = new Map<unknown, number>();
      for (const key of countValues) {
        const bucket = childRows.filter((row) => row[childKeyField] === key);
        countMap.set(key, bucket.length);
      }
      for (const row of rows) {
        const current = row[rel.name];
        if (Array.isArray(current)) {
          (current as Row[] & { _count?: number })._count = countMap.get(row[parentKeyField]) ?? 0;
        } else if (current && typeof current === "object") {
          (current as Row)._count = countMap.get(row[parentKeyField]) ?? 0;
        }
      }
    }
  }
}

export async function executeMultiQuery(
  ast: QueryAST,
  schema: Schema,
  options: MultiOptions,
  resolvedUrl?: string
) {
  const { sql, values } = buildMultiRootSql(ast, schema);
  const rows = await runQuery(sql, values, resolvedUrl, options.client) as Row[];
  const rootRows = rows.map((row) => normalizeRoot(row, ast.select));
  await hydrateRelations(ast.root, rootRows, ast.relations, schema, options, [ast.root]);
  return { rootRows, sql, values };
}

export function shouldUseMultiQuery(ast: QueryAST, schema: Schema): boolean {
  if (ast._count) return false;
  return maxDepth(ast.relations) > 1 || hasReverseRelation(ast.root, ast.relations, schema);
}

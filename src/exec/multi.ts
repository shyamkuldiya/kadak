import pg from "pg";
import { QueryAST, RelationAST } from "../query/ast.js";
import { runQuery } from "./client.js";

type SchemaEntry = string | { table: string; as: string; to: string; source: string } | Record<string, unknown>;
type Schema = Record<string, Record<string, SchemaEntry>>;
type Row = Record<string, unknown>;
type MultiOptions = { client?: pg.PoolClient; debug?: boolean };
type RelationDefinition = { table: string; as: string; to: string; source: string };
type CacheKey = string;

function isRelationEntry(entry: SchemaEntry | undefined): entry is RelationDefinition {
  return !!entry && typeof entry === "object" && "table" in entry && "as" in entry && "to" in entry && "source" in entry;
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

function getBaseFields(tableSchema: Record<string, SchemaEntry>): string[] {
  return Object.keys(tableSchema).filter((field) => {
    const mapping = tableSchema[field];
    if (field === "id") return false;
    if (typeof mapping === "string" && mapping.includes(".")) return false;
    return !isRelationEntry(mapping);
  });
}

function quote(field: string) {
  return `"${field}"`;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function serializeValues(values: unknown[]) {
  return values.map((value) => value === null ? "__null__" : typeof value === "object" ? JSON.stringify(value) : String(value)).join("|");
}

function buildRootSql(ast: QueryAST, schema: Schema) {
  const rootSchema = schema[ast.root] || {};
  const fields = ast.select ? Object.keys(ast.select).filter((f) => f !== "id") : getBaseFields(rootSchema);
  const cols = unique(["id", ...fields]).map((field) => quote(field));
  let sql = `SELECT ${cols.join(", ")} FROM ${ast.root}`;
  const values: unknown[] = [];

  if (ast.where && ast.where.length > 0) {
    const clauses = ast.where.map((p, idx) => {
      values.push(p.value);
      return `${quote(p.field)} = $${idx + 1}`;
    });
    sql += ` WHERE ${clauses.join(" AND ")}`;
  }

  if (ast.orderBy) {
    sql += ` ORDER BY ${quote(ast.orderBy.field)} ${ast.orderBy.direction.toUpperCase()}`;
  }

  if (ast.take !== undefined) sql += ` LIMIT ${ast.take}`;
  if (ast.skip !== undefined) sql += ` OFFSET ${ast.skip}`;

  return { sql, values };
}

function normalizeRoot(row: Row, select?: Record<string, true>) {
  const out: Row = {};
  if (!select || select.id) out.id = row.id;
  for (const [key, value] of Object.entries(row)) {
    if (key === "id") continue;
    if (!select || select[key]) out[key] = value;
  }
  return out;
}

function selectFields(select?: Record<string, true>) {
  return select ? Object.keys(select).filter((field) => field !== "id") : undefined;
}

function parentKeySet(rows: Row[], field: string) {
  return unique(rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined));
}

function cyclePath(path: string[], next: string) {
  return path.includes(next);
}

type LoadedBucket = {
  byKey: Map<unknown, Row[]>;
  single: Map<unknown, Row | null>;
};

function bucketRows(rows: Row[], keyField: string, select?: Record<string, true>): LoadedBucket {
  const byKey = new Map<unknown, Row[]>();
  const single = new Map<unknown, Row | null>();
  for (const row of rows) {
    const key = row[keyField];
    if (key === null || key === undefined) continue;
    const projected = project(row, select);
    const group = byKey.get(key) || [];
    group.push(projected);
    byKey.set(key, group);
    if (!single.has(key)) single.set(key, projected);
  }
  return { byKey, single };
}

function project(row: Row, select?: Record<string, true>) {
  const out: Row = {};
  if (!select) {
    for (const [key, value] of Object.entries(row)) {
      if (key !== "id") out[key] = value;
    }
    return out;
  }
  for (const key of Object.keys(select)) {
    if (key in row) out[key] = row[key];
  }
  if (select.id) out.id = row.id;
  return out;
}

async function fetchBatch(
  table: string,
  field: string,
  values: unknown[],
  schema: Schema,
  select?: Record<string, true>,
  client?: pg.PoolClient,
  cache?: Map<CacheKey, Promise<Row[]>>
) {
  const cacheKey = `${table}:${field}:${select ? Object.keys(select).sort().join(",") : "*"}:${serializeValues(values)}`;
  if (cache?.has(cacheKey)) return await cache.get(cacheKey)!;
  const tableSchema = schema[table] || {};
  const fields = selectFields(select) ?? getBaseFields(tableSchema);
  const cols = unique(["id", ...fields]).map((f) => quote(f));
  const placeholders = values.map((_, idx) => `$${idx + 1}`);
  const sql = `SELECT ${cols.join(", ")} FROM ${table} WHERE ${quote(field)} IN (${placeholders.join(", ")})`;
  const query = runQuery(sql, values, undefined, client) as Promise<Row[]>;
  cache?.set(cacheKey, query);
  return await query;
}

function relationShapeNeedsBatch(rel: RelationAST, schema: Schema, parentTable: string): boolean {
  const relation = getRelation(schema[parentTable] || {}, rel.name);
  if (!relation) return false;
  return rel.relations.length > 0 || !!rel._count || relation.source !== "id" || relation.to !== "id";
}

function shouldUseMultiQuery(ast: QueryAST, schema: Schema): boolean {
  const depth = (relations: RelationAST[]): number => relations.reduce((max, rel) => Math.max(max, 1 + depth(rel.relations)), 0);
  if (ast._count) return false;
  if (depth(ast.relations) > 1) return true;
  return ast.relations.some((rel) => relationShapeNeedsBatch(rel, schema, ast.root));
}

async function hydrateLayer(
  tableName: string,
  rows: Row[],
  relations: RelationAST[],
  schema: Schema,
  options: MultiOptions,
  path: string[],
  cache: Map<CacheKey, Promise<Row[]>>
) {
  const tableSchema = schema[tableName] || {};
  await Promise.all(relations.map(async (rel) => {
    const relation = getRelation(tableSchema, rel.name);
    if (!relation) return;

    const nextTable = relation.table;
    const parentKey = relation.source;
    const childKey = relation.to || "id";
    const values = parentKeySet(rows, parentKey);
    if (values.length === 0) {
      for (const row of rows) {
        row[rel.name] = rel._count ? { _count: 0 } : (childKey === "id" ? null : []);
      }
      return;
    }

    if (rel._count && !rel.select && rel.relations.length === 0) {
      const placeholders = values.map((_, idx) => `$${idx + 1}`);
      const sql = `SELECT ${quote(childKey)} AS "__kadak_fk", COUNT(*) AS "__kadak_count" FROM ${nextTable} WHERE ${quote(childKey)} IN (${placeholders.join(", ")}) GROUP BY ${quote(childKey)}`;
      const countRows = await runQuery(sql, values, undefined, options.client) as Row[];
      const countMap = new Map<unknown, number>();
      for (const countRow of countRows) {
        const key = countRow.__kadak_fk;
        const count = typeof countRow.__kadak_count === "string" ? Number(countRow.__kadak_count) : Number(countRow.__kadak_count ?? 0);
        countMap.set(key, count);
      }
      for (const row of rows) {
        row[rel.name] = { _count: countMap.get(row[parentKey]) ?? 0 };
      }
      return;
    }

    const childRows = await fetchBatch(nextTable, childKey, values, schema, rel.select, options.client, cache);
    const nextPath = path.concat(tableName);
    const cyclic = cyclePath(nextPath, nextTable);

    if (!cyclic && rel.relations.length > 0) {
      await hydrateLayer(nextTable, childRows, rel.relations, schema, options, nextPath, cache);
    }

    if (childKey === "id") {
      const childMap = bucketRows(childRows, childKey, rel.select).single;
      for (const row of rows) {
        const child = childMap.get(row[parentKey]) ?? null;
        row[rel.name] = child ? project(child, rel.select) : null;
      }
    } else {
      const grouped = bucketRows(childRows, childKey, rel.select).byKey;
      for (const row of rows) {
        row[rel.name] = (grouped.get(row[parentKey]) || []).map((child) => project(child, rel.select));
      }
    }

    if (rel._count) {
      const countMap = new Map<unknown, number>();
      for (const [key, bucket] of bucketRows(childRows, childKey, rel.select).byKey.entries()) {
        countMap.set(key, bucket.length);
      }
      for (const row of rows) {
        const current = row[rel.name];
        const count = countMap.get(row[parentKey]) ?? 0;
        if (Array.isArray(current)) {
          (current as Row[] & { _count?: number })._count = count;
        } else if (current && typeof current === "object") {
          (current as Row)._count = count;
        }
      }
    }
  }));
}

export async function executeMultiQuery(ast: QueryAST, schema: Schema, options: MultiOptions, resolvedUrl?: string) {
  const { sql, values } = buildRootSql(ast, schema);
  const rootRows = (await runQuery(sql, values, resolvedUrl, options.client)) as Row[];
  const rows = rootRows.map((row) => normalizeRoot(row, ast.select));
  const cache = new Map<CacheKey, Promise<Row[]>>();
  await hydrateLayer(ast.root, rows, ast.relations, schema, options, [ast.root], cache);
  return { rootRows: rows, sql, values };
}

export function buildMultiRootSql(ast: QueryAST, schema: Schema) {
  return buildRootSql(ast, schema);
}

export { shouldUseMultiQuery };

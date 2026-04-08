import pg from "pg";
import { QueryAST, RelationAST } from "../query/ast.js";
import { runQuery } from "./client.js";

export type SchemaEntry =
  | string
  | { table: string; as: string; to: string; source: string }
  | Record<string, unknown>;

export type RuntimeRelation = { table: string; as: string; to: string; source: string };
export type RuntimeTable = { fields: string[]; relations: Record<string, RuntimeRelation> };
export type RuntimeSchema = Record<string, RuntimeTable>;
export type RawSchema = Record<string, Record<string, SchemaEntry>>;

export type ExecutionEdge = {
  parentTable: string;
  relationName: string;
  childTable: string;
  parentKey: string;
  childKey: string;
  select?: Record<string, true>;
  _count?: boolean;
  relations: RelationAST[];
};

type Row = Record<string, unknown>;
type CacheKey = string;
type EngineOptions = { client?: pg.PoolClient; debug?: boolean };

function quote(field: string) {
  return `"${field}"`;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function valuesKey(values: unknown[]) {
  return values
    .map((value) => (value === null ? "__null__" : typeof value === "object" ? JSON.stringify(value) : String(value)))
    .join("|");
}

function isRelationEntry(entry: SchemaEntry | undefined): entry is RuntimeRelation {
  return !!entry && typeof entry === "object" && "table" in entry && "as" in entry && "to" in entry && "source" in entry;
}

export function compileRuntimeSchema(raw: RawSchema): RuntimeSchema {
  const compiled: RuntimeSchema = {};

  for (const [tableName, tableSchema] of Object.entries(raw)) {
    const fields: string[] = [];
    const relations: Record<string, RuntimeRelation> = {};

    for (const [field, entry] of Object.entries(tableSchema)) {
      if (field === "id") continue;
      if (isRelationEntry(entry)) {
        relations[field] = entry;
        continue;
      }
      if (typeof entry === "string" && entry.includes(".")) {
        const [table, to] = entry.split(".");
        relations[field] = { table, as: field, to: to || "id", source: "id" };
        continue;
      }
      fields.push(field);
    }

    compiled[tableName] = { fields, relations };
  }

  return compiled;
}

function buildRootSql(ast: QueryAST, schema: RuntimeSchema) {
  const rootSchema = schema[ast.root] || { fields: [], relations: {} };
  const fields = ast.select ? Object.keys(ast.select).filter((field) => field !== "id") : rootSchema.fields;
  const cols = unique(["id", ...fields]).map(quote);
  const values: unknown[] = [];
  let sql = `SELECT ${cols.join(", ")} FROM ${ast.root}`;

  if (ast.where?.length) {
    const clauses = ast.where.map((predicate, index) => {
      values.push(predicate.value);
      return `${quote(predicate.field)} = $${index + 1}`;
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

function collectEdges(astRoot: string, relations: RelationAST[], schema: RuntimeSchema) {
  const edges: ExecutionEdge[] = [];
  const queue: Array<{ tableName: string; relations: RelationAST[] }> = [{ tableName: astRoot, relations }];

  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { tableName, relations } = queue[cursor];
    const tableSchema = schema[tableName] || { fields: [], relations: {} };

    for (const rel of relations) {
      const relation = tableSchema.relations[rel.name];
      if (!relation) continue;
      edges.push({
        parentTable: tableName,
        relationName: rel.name,
        childTable: relation.table,
        parentKey: relation.source,
        childKey: relation.to || "id",
        select: rel.select,
        _count: rel._count,
        relations: rel.relations,
      });
      if (rel.relations.length > 0) queue.push({ tableName: relation.table, relations: rel.relations });
    }
  }

  return edges;
}

function parentKeys(rows: Row[], field: string) {
  return unique(rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined));
}

function project(row: Row, select?: Record<string, true>) {
  if (!select) {
    const out: Row = {};
    for (const [key, value] of Object.entries(row)) {
      if (key !== "id") out[key] = value;
    }
    return out;
  }
  const out: Row = {};
  for (const key of Object.keys(select)) {
    if (key in row) out[key] = row[key];
  }
  if (select.id) out.id = row.id;
  return out;
}

function bucket(rows: Row[], keyField: string, select?: Record<string, true>) {
  const many = new Map<unknown, Row[]>();
  const one = new Map<unknown, Row | null>();
  for (const row of rows) {
    const key = row[keyField];
    if (key === null || key === undefined) continue;
    const projected = project(row, select);
    const list = many.get(key) || [];
    list.push(projected);
    many.set(key, list);
    if (!one.has(key)) one.set(key, projected);
  }
  return { many, one };
}

async function fetchMany(
  table: string,
  field: string,
  values: unknown[],
  schema: RuntimeSchema,
  select?: Record<string, true>,
  client?: pg.PoolClient,
  cache?: Map<CacheKey, Promise<Row[]>>
) {
  const key = `${table}:${field}:${select ? Object.keys(select).sort().join(",") : "*"}:${valuesKey(values)}`;
  if (cache?.has(key)) return await cache.get(key)!;
  const tableSchema = schema[table] || { fields: [], relations: {} };
  const fields = select ? Object.keys(select).filter((field) => field !== "id") : tableSchema.fields;
  const cols = unique(["id", ...fields]).map(quote);
  const placeholders = values.map((_, index) => `$${index + 1}`);
  const sql = `SELECT ${cols.join(", ")} FROM ${table} WHERE ${quote(field)} IN (${placeholders.join(", ")})`;
  const query = runQuery(sql, values, undefined, client) as Promise<Row[]>;
  cache?.set(key, query);
  return await query;
}

export async function executeEngine(ast: QueryAST, schema: RuntimeSchema, options: EngineOptions, resolvedUrl?: string) {
  const { sql, values } = buildRootSql(ast, schema);
  const rootRows = (await runQuery(sql, values, resolvedUrl, options.client)) as Row[];

  if (ast._count) {
    const raw = rootRows[0]?._count ?? rootRows[0]?.count ?? rootRows[0]?.count_star;
    const countValue = typeof raw === "string" ? Number(raw) : Number(raw ?? 0);
    return { rootRows: { [ast.root]: { _count: countValue } }, sql, values };
  }

  if (!ast.relations || ast.relations.length === 0) {
    return { rootRows, sql, values };
  }

  const edges = collectEdges(ast.root, ast.relations, schema);
  if (edges.length === 0) {
    return { rootRows, sql, values };
  }

  const useMulti =
    ast.relations.length > 1 ||
    ast.relations.some((rel) => {
      const relation = schema[ast.root]?.relations?.[rel.name];
      if (!relation) return false;
      return rel.relations.length > 0 || !!rel._count || relation.source !== "id" || relation.to !== "id";
    });

  if (!useMulti) {
    return { rootRows, sql, values };
  }

  const cache = new Map<CacheKey, Promise<Row[]>>();
  const frontier = new Map<string, Row[]>();
  frontier.set(ast.root, rootRows);
  const grouped = new Map<string, ExecutionEdge[]>();
  for (const edge of edges) {
    const list = grouped.get(edge.parentTable) || [];
    list.push(edge);
    grouped.set(edge.parentTable, list);
  }
  for (const [tableName, rels] of grouped.entries()) {
    grouped.set(tableName, rels.slice().sort((a, b) => a.relationName.localeCompare(b.relationName)));
  }

  const seen = new Set<string>();
  const maxPasses = Math.max(1, edges.length + 1);

  for (let pass = 0; pass < maxPasses; pass++) {
    let progressed = false;
    const active = Array.from(frontier.entries()).sort(([a], [b]) => a.localeCompare(b));
    frontier.clear();

    for (const [tableName, rows] of active) {
      const rels = grouped.get(tableName) || [];
      for (const edge of rels) {
        const key = `${tableName}:${edge.relationName}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const values = parentKeys(rows, edge.parentKey);
        if (values.length === 0) {
          for (const row of rows) row[edge.relationName] = edge._count ? { _count: 0 } : edge.childKey === "id" ? null : [];
          continue;
        }

        progressed = true;

        if (edge._count && !edge.select && edge.relations.length === 0) {
          const placeholders = values.map((_, index) => `$${index + 1}`);
          const sql = `SELECT ${quote(edge.childKey)} AS "__kadak_fk", COUNT(*) AS "__kadak_count" FROM ${edge.childTable} WHERE ${quote(edge.childKey)} IN (${placeholders.join(", ")}) GROUP BY ${quote(edge.childKey)}`;
          const countRows = (await runQuery(sql, values, undefined, options.client)) as Row[];
          const counts = new Map<unknown, number>();
          for (const row of countRows) {
            const key = row.__kadak_fk;
            const count = typeof row.__kadak_count === "string" ? Number(row.__kadak_count) : Number(row.__kadak_count ?? 0);
            counts.set(key, count);
          }
          for (const row of rows) row[edge.relationName] = { _count: counts.get(row[edge.parentKey]) ?? 0 };
          continue;
        }

        const children = await fetchMany(edge.childTable, edge.childKey, values, schema, edge.select, options.client, cache);
        const buckets = bucket(children, edge.childKey, edge.select);
        for (const row of rows) {
          const parentValue = row[edge.parentKey];
          if (edge.childKey === "id") {
            const child = buckets.one.get(parentValue) ?? null;
            row[edge.relationName] = child ? project(child, edge.select) : null;
          } else {
            const items = buckets.many.get(parentValue) || [];
            row[edge.relationName] = items.map((child) => project(child, edge.select));
          }
        }

        if (edge._count) {
          const counts = new Map<unknown, number>();
          for (const [key, items] of buckets.many.entries()) counts.set(key, items.length);
          for (const row of rows) {
            const current = row[edge.relationName];
            const count = counts.get(row[edge.parentKey]) ?? 0;
            if (Array.isArray(current)) {
              (current as Row[] & { _count?: number })._count = count;
            } else if (current && typeof current === "object") {
              (current as Row)._count = count;
            } else {
              row[edge.relationName] = { _count: count };
            }
          }
        }

        if (edge.relations.length > 0 && children.length > 0) {
          const next = frontier.get(edge.childTable) || [];
          next.push(...children);
          frontier.set(edge.childTable, next);
        }
      }
    }

    if (!progressed || frontier.size === 0) break;
  }

  const select = ast.select;
  if (!select) return { rootRows, sql, values };
  const projected = rootRows.map((row) => {
    const out: Row = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === "id") {
        if (select.id) out.id = value;
        continue;
      }
      if (key in select) {
        out[key] = value;
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        out[key] = value;
      } else if (Array.isArray(value)) {
        out[key] = value;
      }
    }
    return out;
  });
  return { rootRows: projected, sql, values };
}

import pg from "pg";
import { QueryAST } from "../query/ast.js";
import { runQuery } from "./client.js";
import { buildExecutionPlan, type ExecutionEdge, type ExecutionPlan, type Schema } from "./multi-plan.js";

type Row = Record<string, unknown>;
type MultiOptions = { client?: pg.PoolClient; debug?: boolean };
type CacheKey = string;

function getBaseFields(tableSchema: Record<string, unknown>): string[] {
  return Object.keys(tableSchema).filter((field) => field !== "id");
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

function parentKeySet(rows: Row[], field: string) {
  return unique(rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined));
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
  const fields = select ? Object.keys(select).filter((field) => field !== "id") : getBaseFields(tableSchema);
  const cols = unique(["id", ...fields]).map((f) => quote(f));
  const placeholders = values.map((_, idx) => `$${idx + 1}`);
  const sql = `SELECT ${cols.join(", ")} FROM ${table} WHERE ${quote(field)} IN (${placeholders.join(", ")})`;
  const query = runQuery(sql, values, undefined, client) as Promise<Row[]>;
  cache?.set(cacheKey, query);
  return await query;
}


async function hydratePlan(
  plan: ExecutionPlan,
  rows: Row[],
  schema: Schema,
  options: MultiOptions,
  cache: Map<CacheKey, Promise<Row[]>>
) {
  const groupedEdges = new Map<string, ExecutionEdge[]>();
  for (const edge of plan.edges) {
    const list = groupedEdges.get(edge.parentTable) || [];
    list.push(edge);
    groupedEdges.set(edge.parentTable, list);
  }
  for (const [tableName, edges] of groupedEdges.entries()) {
    groupedEdges.set(tableName, edges.slice().sort((a, b) => a.relationName.localeCompare(b.relationName)));
  }

  const frontier = new Map<string, Row[]>();
  frontier.set(plan.root, rows);

  const visited = new Set<string>();
  const maxPasses = Math.max(1, plan.edges.length + 1);

  for (let pass = 0; pass < maxPasses; pass++) {
    let progressed = false;
    const currentFrontier = Array.from(frontier.entries()).sort(([a], [b]) => a.localeCompare(b));
    frontier.clear();

    for (const [tableName, tableRows] of currentFrontier) {
      const edges = groupedEdges.get(tableName) || [];
      if (edges.length === 0 || tableRows.length === 0) continue;

      for (const edge of edges) {
        const edgeKey = `${tableName}:${edge.relationName}`;
        if (visited.has(edgeKey)) continue;
        visited.add(edgeKey);

        const values = parentKeySet(tableRows, edge.parentKey);
        if (values.length === 0) {
          for (const row of tableRows) {
            row[edge.relationName] = edge._count ? { _count: 0 } : (edge.childKey === "id" ? null : []);
          }
          continue;
        }

        progressed = true;

        if (edge._count && !edge.select && edge.relations.length === 0) {
          const placeholders = values.map((_, idx) => `$${idx + 1}`);
          const sql = `SELECT ${quote(edge.childKey)} AS "__kadak_fk", COUNT(*) AS "__kadak_count" FROM ${edge.childTable} WHERE ${quote(edge.childKey)} IN (${placeholders.join(", ")}) GROUP BY ${quote(edge.childKey)}`;
          const countRows = await runQuery(sql, values, undefined, options.client) as Row[];
          const countMap = new Map<unknown, number>();
          for (const countRow of countRows) {
            const key = countRow.__kadak_fk;
            const count = typeof countRow.__kadak_count === "string" ? Number(countRow.__kadak_count) : Number(countRow.__kadak_count ?? 0);
            countMap.set(key, count);
          }
          for (const row of tableRows) {
            row[edge.relationName] = { _count: countMap.get(row[edge.parentKey]) ?? 0 };
          }
          continue;
        }

        const childRows = await fetchBatch(edge.childTable, edge.childKey, values, schema, edge.select, options.client, cache);
        const buckets = bucketRows(childRows, edge.childKey, edge.select);
        const childBucket = edge.childKey === "id" ? buckets.single : buckets.byKey;

        for (const row of tableRows) {
          const parentValue = row[edge.parentKey];
          if (edge.childKey === "id") {
            const child = (childBucket as Map<unknown, Row | null>).get(parentValue) ?? null;
            row[edge.relationName] = child ? project(child, edge.select) : null;
          } else {
            const items = (childBucket as Map<unknown, Row[]>).get(parentValue) || [];
            row[edge.relationName] = items.map((child) => project(child, edge.select));
          }
        }

        if (edge._count) {
          const countMap = new Map<unknown, number>();
          for (const [key, bucket] of buckets.byKey.entries()) {
            countMap.set(key, bucket.length);
          }
          for (const row of tableRows) {
            const count = countMap.get(row[edge.parentKey]) ?? 0;
            const current = row[edge.relationName];
            if (Array.isArray(current)) {
              (current as Row[] & { _count?: number })._count = count;
            } else if (current && typeof current === "object") {
              (current as Row)._count = count;
            } else {
              row[edge.relationName] = { _count: count };
            }
          }
        }

        if (edge.relations.length > 0 && childRows.length > 0) {
          const nextList = frontier.get(edge.childTable) || [];
          nextList.push(...childRows);
          frontier.set(edge.childTable, nextList);
        }
      }
    }

    if (!progressed || frontier.size === 0) break;
  }
}

export async function executeMultiQuery(ast: QueryAST, schema: Schema, options: MultiOptions, resolvedUrl?: string) {
  const { sql, values } = buildRootSql(ast, schema);
  const rows = (await runQuery(sql, values, resolvedUrl, options.client)) as Row[];
  const cache = new Map<CacheKey, Promise<Row[]>>();
  const plan = buildExecutionPlan(ast, schema);
  await hydratePlan(plan, rows, schema, options, cache);
  const select = ast.select;
  if (!select) return { rootRows: rows, sql, values };
  const rootRows = rows.map((row) => {
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
  return { rootRows, sql, values };
}

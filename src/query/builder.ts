import { QueryAST, RelationAST, Predicate, OrderBy } from "./ast.js";

export function buildAST(queryInput: Record<string, unknown>): QueryAST {
  const rootKey = Object.keys(queryInput)[0];
  const rootValue = queryInput[rootKey] as Record<string, unknown>;
  
  const { where, relations, orderBy, select, take, skip, count } = parseNode(rootValue, true);
  
  return {
    root: rootKey,
    count,
    select,
    take,
    skip,
    where: where.length > 0 ? where : undefined,
    orderBy,
    relations
  };
}

function parseNode(input: Record<string, unknown>, isRoot: boolean): { where: Predicate[], relations: RelationAST[], orderBy?: OrderBy, select?: Record<string, true>, take?: number, skip?: number, count?: boolean } {
  const where: Predicate[] = [];
  const relations: RelationAST[] = [];
  let orderBy: OrderBy | undefined;
  let select: Record<string, true> | undefined;
  let take: number | undefined;
  let skip: number | undefined;
  let count: boolean | undefined;

  for (const [key, value] of Object.entries(input)) {
    if (key === "where") {
      const whereObj = value as Record<string, unknown>;
      for (const [field, val] of Object.entries(whereObj)) {
        where.push({ field, value: val });
      }
    } else if (key === "orderBy") {
      const orderObj = value as Record<string, string>;
      const field = Object.keys(orderObj)[0];
      const direction = orderObj[field].toLowerCase() as "asc" | "desc";
      orderBy = { field, direction };
    } else if (key === "select") {
      if (input.count) {
        throw new Error("Kadak Error: count cannot be mixed with select, relations, or ordering");
      }
      select = {};
      for (const [field, enabled] of Object.entries(value as Record<string, unknown>)) {
        if (enabled) select[field] = true;
      }
    } else if (key === "count") {
      count = Boolean(value);
      if (count) {
        if (Object.keys(input).some((k) => !["count", "where"].includes(k))) {
          throw new Error("Kadak Error: count cannot be mixed with select, relations, or ordering");
        }
      }
    } else if (key === "take") {
      if (!isRoot) {
        throw new Error("Kadak Error: nested pagination is not supported yet");
      }
      if (input.count) {
        throw new Error("Kadak Error: count cannot be mixed with select, relations, or ordering");
      }
      take = Number(value);
    } else if (key === "skip") {
      if (!isRoot) {
        throw new Error("Kadak Error: nested pagination is not supported yet");
      }
      if (input.count) {
        throw new Error("Kadak Error: count cannot be mixed with select, relations, or ordering");
      }
      skip = Number(value);
    } else if (value === true || (typeof value === "object" && value !== null)) {
      if (input.count) {
        throw new Error("Kadak Error: count cannot be mixed with select, relations, or ordering");
      }
      const relationInput = value === true ? {} : (value as Record<string, unknown>);
      const { relations: nestedRelations, select: nestedSelect } = parseNode(relationInput, false);
      relations.push({
        name: key,
        select: nestedSelect,
        relations: nestedRelations
      });
    }
  }

  return { where, relations, orderBy, select, take, skip, count };
}

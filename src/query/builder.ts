import { QueryAST, RelationAST, Predicate, OrderBy } from "./ast.js";

export function buildAST(queryInput: Record<string, unknown>): QueryAST {
  const rootKey = Object.keys(queryInput)[0];
  const rootValue = queryInput[rootKey] as Record<string, unknown>;
  
  const { where, relations, orderBy, select, take, skip } = parseNode(rootValue);
  
  return {
    root: rootKey,
    select,
    take,
    skip,
    where: where.length > 0 ? where : undefined,
    orderBy,
    relations
  };
}

function parseNode(input: Record<string, unknown>): { where: Predicate[], relations: RelationAST[], orderBy?: OrderBy, select?: Record<string, true>, take?: number, skip?: number } {
  const where: Predicate[] = [];
  const relations: RelationAST[] = [];
  let orderBy: OrderBy | undefined;
  let select: Record<string, true> | undefined;
  let take: number | undefined;
  let skip: number | undefined;

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
      select = {};
      for (const [field, enabled] of Object.entries(value as Record<string, unknown>)) {
        if (enabled) select[field] = true;
      }
    } else if (key === "take") {
      take = Number(value);
    } else if (key === "skip") {
      skip = Number(value);
    } else if (value === true || (typeof value === "object" && value !== null)) {
      const relationInput = value === true ? {} : (value as Record<string, unknown>);
      const { relations: nestedRelations, select: nestedSelect } = parseNode(relationInput);
      relations.push({
        name: key,
        select: nestedSelect,
        relations: nestedRelations
      });
    }
  }

  return { where, relations, orderBy, select, take, skip };
}

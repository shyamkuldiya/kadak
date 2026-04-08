import { QueryAST, RelationAST, Predicate, OrderBy } from "./ast.js";

export function buildAST(queryInput: Record<string, unknown>): QueryAST {
  const rootKey = Object.keys(queryInput)[0];
  const rootValue = queryInput[rootKey] as Record<string, unknown>;
  
  const { where, relations, orderBy, select, take, skip, _count } = parseNode(rootValue, true);
  
  return {
    root: rootKey,
    _count,
    select,
    take,
    skip,
    where: where.length > 0 ? where : undefined,
    orderBy,
    relations
  };
}

function parseNode(input: Record<string, unknown>, isRoot: boolean): { where: Predicate[], relations: RelationAST[], orderBy?: OrderBy, select?: Record<string, true>, take?: number, skip?: number, _count?: boolean } {
  const where: Predicate[] = [];
  const relations: RelationAST[] = [];
  let orderBy: OrderBy | undefined;
  let select: Record<string, true> | undefined;
  let take: number | undefined;
  let skip: number | undefined;
  let _count: boolean | undefined;

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
    } else if (key === "_count") {
      _count = Boolean(value);
    } else if (key === "take") {
      if (!isRoot) {
        throw new Error("Kadak Error: nested pagination is not supported yet");
      }
      take = Number(value);
    } else if (key === "skip") {
      if (!isRoot) {
        throw new Error("Kadak Error: nested pagination is not supported yet");
      }
      skip = Number(value);
    } else if (value === true || (typeof value === "object" && value !== null)) {
      const relationInput = value === true ? {} : (value as Record<string, unknown>);
      const relationCount = relationInput._count === true;
      if (relationCount) {
        const nestedKeys = Object.keys(relationInput).filter((k) => k !== "_count");
        if (nestedKeys.length > 0) {
          throw new Error("Kadak Error: _count cannot be combined with fields or nested relations");
        }
      }
      if (_count) {
        throw new Error("Kadak Error: _count cannot be mixed with relations");
      }
      const { relations: nestedRelations, select: nestedSelect } = parseNode(relationInput, false);
      relations.push({
        name: key,
        _count: relationCount,
        select: nestedSelect,
        relations: nestedRelations
      });
    }
  }

  return { where, relations, orderBy, select, take, skip, _count };
}

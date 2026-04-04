export type Predicate = { field: string; value: unknown };

export type RelationAST = {
  name: string;
  relations: RelationAST[];
};

export type OrderBy = {
  field: string;
  direction: "asc" | "desc";
};

export type QueryAST = {
  root: string;
  where?: Predicate[];
  orderBy?: OrderBy;
  relations: RelationAST[];
};

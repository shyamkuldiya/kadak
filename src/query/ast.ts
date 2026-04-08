export type Predicate = { field: string; value: unknown };

export type RelationAST = {
  name: string;
  _count?: boolean;
  select?: Record<string, true>;
  relations: RelationAST[];
};

export type OrderBy = {
  field: string;
  direction: "asc" | "desc";
};

export type QueryAST = {
  root: string;
  _count?: boolean;
  select?: Record<string, true>;
  take?: number;
  skip?: number;
  where?: Predicate[];
  orderBy?: OrderBy;
  relations: RelationAST[];
};

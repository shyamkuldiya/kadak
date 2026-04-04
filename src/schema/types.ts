export type ScalarValue = string | number | boolean | object | null;

export type Scalar =
  | { type: "int"; nullable?: boolean; unique?: boolean; default?: number }
  | { type: "varchar"; length: number; nullable?: boolean; unique?: boolean; default?: string }
  | { type: "text"; nullable?: boolean; unique?: boolean; default?: string }
  | { type: "jsonb"; nullable?: boolean; unique?: boolean; default?: ScalarValue };

export type Ref = {
  ref: string;
  nullable?: boolean;
  index?: boolean;
  unique?: boolean;
  onDelete?: "cascade" | "restrict" | "set null";
};

export type ColumnDef = Scalar | Ref | "string" | "int" | "text" | "jsonb";

export type TableDef = Record<string, ColumnDef>;

export type SchemaDef = Record<string, TableDef>;

export type DBSchema = {
  tables: Record<string, {
    columns: Record<string, {
      type: string;
      nullable: boolean;
      default?: string;
    }>;
    fks: Array<{
      column: string;
      refTable: string;
      refColumn: string;
      onDelete?: string;
    }>;
    indexes: Array<{
      name: string;
      columns: string[];
      unique: boolean;
      where?: string;
    }>;
  }>;
};

// Canonical forms
export type CanonicalColumn = {
  type: "int" | "varchar" | "text" | "jsonb";
  length?: number;
  nullable: boolean;
  unique: boolean;
  default?: ScalarValue;
};

export type CanonicalRef = {
  refTable: string;
  nullable: boolean;
  index: boolean;
  unique: boolean;
  onDelete?: "cascade" | "restrict" | "set null";
};

export type CanonicalTableDef = Record<string, CanonicalColumn | CanonicalRef>;
export type CanonicalSchemaDef = Record<string, CanonicalTableDef>;

import * as pg from 'pg';
import pg__default from 'pg';
import { z } from 'zod';

type ScalarValue = string | number | boolean | object | null;
type Scalar = {
    type: "int";
    nullable?: boolean;
    unique?: boolean;
    default?: number;
} | {
    type: "varchar";
    length: number;
    nullable?: boolean;
    unique?: boolean;
    default?: string;
} | {
    type: "text";
    nullable?: boolean;
    unique?: boolean;
    default?: string;
} | {
    type: "jsonb";
    nullable?: boolean;
    unique?: boolean;
    default?: ScalarValue;
};
type Ref = {
    ref: string;
    nullable?: boolean;
    index?: boolean;
    unique?: boolean;
    onDelete?: "cascade" | "restrict" | "set null";
};
type ColumnDef = Scalar | Ref | "string" | "int" | "text" | "jsonb";
type TableDef = Record<string, ColumnDef>;
type SchemaDef = Record<string, TableDef>;
type DBSchema = {
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
type CanonicalColumn = {
    type: "int" | "varchar" | "text" | "jsonb";
    length?: number;
    nullable: boolean;
    unique: boolean;
    default?: ScalarValue;
};
type CanonicalRef = {
    refTable: string;
    nullable: boolean;
    index: boolean;
    unique: boolean;
    onDelete?: "cascade" | "restrict" | "set null";
};
type CanonicalTableDef = Record<string, CanonicalColumn | CanonicalRef>;
type CanonicalSchemaDef = Record<string, CanonicalTableDef>;

type PredicateValue = string | number | boolean | null;
type Predicate = {
    op: "eq";
    column: string;
    value: PredicateValue;
} | {
    op: "and";
    nodes: Predicate[];
};
type ASTNode = {
    table: string;
    alias: string;
    where?: Predicate[];
    orderBy?: {
        column: string;
        dir: "asc" | "desc";
    }[];
    limit?: number;
    relations: ASTNode[];
    selectAll: boolean;
};
type QueryAST = {
    root: ASTNode;
};

type Plan = {
    from: {
        table: string;
        alias: string;
    };
    joins: Array<{
        type: "left";
        table: string;
        alias: string;
        on: {
            left: string;
            right: string;
        }[];
    }>;
    where: Predicate[];
    orderBy?: {
        column: string;
        dir: "asc" | "desc";
    }[];
    limit?: number;
    select: Array<{
        table: string;
        tableAlias: string;
        selectAll: boolean;
    }>;
};
declare class Planner {
    private schema;
    constructor(schema?: CanonicalSchemaDef);
    plan(astRoot: ASTNode): Plan;
    private traverse;
}

type Compiled = {
    text: string;
    values: PredicateValue[];
};
declare class Compiler {
    private schema;
    constructor(schema?: CanonicalSchemaDef);
    compile(plan: Plan): Compiled;
}

declare function normalizeColumn(col: ColumnDef): CanonicalColumn | CanonicalRef;
declare function normalizeSchema(schema: SchemaDef): CanonicalSchemaDef;

declare const ScalarSchema: z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodLiteral<"int">;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"varchar">;
    length: z.ZodNumber;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"text">;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"jsonb">;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strip>, z.ZodLiteral<"string">, z.ZodLiteral<"int">, z.ZodLiteral<"text">, z.ZodLiteral<"jsonb">]>;
declare const RefSchema: z.ZodObject<{
    ref: z.ZodString;
    nullable: z.ZodOptional<z.ZodBoolean>;
    index: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    onDelete: z.ZodOptional<z.ZodEnum<{
        cascade: "cascade";
        restrict: "restrict";
        "set null": "set null";
    }>>;
}, z.core.$strip>;
declare const ColumnDefSchema: z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodLiteral<"int">;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"varchar">;
    length: z.ZodNumber;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"text">;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"jsonb">;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strip>, z.ZodLiteral<"string">, z.ZodLiteral<"int">, z.ZodLiteral<"text">, z.ZodLiteral<"jsonb">]>, z.ZodObject<{
    ref: z.ZodString;
    nullable: z.ZodOptional<z.ZodBoolean>;
    index: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    onDelete: z.ZodOptional<z.ZodEnum<{
        cascade: "cascade";
        restrict: "restrict";
        "set null": "set null";
    }>>;
}, z.core.$strip>]>;
declare const TableDefSchema: z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodLiteral<"int">;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"varchar">;
    length: z.ZodNumber;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"text">;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"jsonb">;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strip>, z.ZodLiteral<"string">, z.ZodLiteral<"int">, z.ZodLiteral<"text">, z.ZodLiteral<"jsonb">]>, z.ZodObject<{
    ref: z.ZodString;
    nullable: z.ZodOptional<z.ZodBoolean>;
    index: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    onDelete: z.ZodOptional<z.ZodEnum<{
        cascade: "cascade";
        restrict: "restrict";
        "set null": "set null";
    }>>;
}, z.core.$strip>]>>;
declare const SchemaDefSchema: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodObject<{
    type: z.ZodLiteral<"int">;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"varchar">;
    length: z.ZodNumber;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"text">;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    type: z.ZodLiteral<"jsonb">;
    nullable: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    default: z.ZodOptional<z.ZodUnknown>;
}, z.core.$strip>, z.ZodLiteral<"string">, z.ZodLiteral<"int">, z.ZodLiteral<"text">, z.ZodLiteral<"jsonb">]>, z.ZodObject<{
    ref: z.ZodString;
    nullable: z.ZodOptional<z.ZodBoolean>;
    index: z.ZodOptional<z.ZodBoolean>;
    unique: z.ZodOptional<z.ZodBoolean>;
    onDelete: z.ZodOptional<z.ZodEnum<{
        cascade: "cascade";
        restrict: "restrict";
        "set null": "set null";
    }>>;
}, z.core.$strip>]>>>;
declare const QueryInputSchema: z.ZodRecord<z.ZodString, z.ZodUnknown>;
declare function validateSchemaDef(input: unknown): Record<string, Record<string, "string" | "int" | "text" | "jsonb" | {
    type: "int";
    nullable?: boolean | undefined;
    unique?: boolean | undefined;
    default?: number | undefined;
} | {
    type: "varchar";
    length: number;
    nullable?: boolean | undefined;
    unique?: boolean | undefined;
    default?: string | undefined;
} | {
    type: "text";
    nullable?: boolean | undefined;
    unique?: boolean | undefined;
    default?: string | undefined;
} | {
    type: "jsonb";
    nullable?: boolean | undefined;
    unique?: boolean | undefined;
    default?: unknown;
} | {
    ref: string;
    nullable?: boolean | undefined;
    index?: boolean | undefined;
    unique?: boolean | undefined;
    onDelete?: "cascade" | "restrict" | "set null" | undefined;
}>>;
declare function validateQueryInput(input: unknown): Record<string, unknown>;

declare class QueryBuilder {
    private schema;
    private aliasCounter;
    constructor(schema?: CanonicalSchemaDef);
    private getAlias;
    private buildWhere;
    buildAST(rootTable: string, queryInput: Record<string, unknown>): QueryAST;
    private parseNode;
}

declare class KadakClient {
    private pool;
    constructor(connectionString: string);
    execute(compiled: Compiled): Promise<Record<string, unknown>[]>;
    explain(compiled: Compiled): Promise<Record<string, unknown>[]>;
    getClient(): Promise<pg__default.PoolClient>;
    close(): Promise<void>;
}

declare function transaction<T>(client: KadakClient, callback: (txClient: pg__default.PoolClient) => Promise<T>): Promise<T>;

interface NormalizedObject {
    id: unknown;
    [key: string]: unknown;
}
declare function normalizeRows(rows: Record<string, unknown>[], ast: QueryAST): NormalizedObject[];

type AnalyzerWarning = {
    type: "warning";
    message: string;
    suggestion: string;
};
declare function analyzePlan(plan: Plan): AnalyzerWarning[];

interface KadakDataPromise<T> extends Promise<T> {
    toSQL: () => Compiled;
    explain: () => Promise<Record<string, unknown>[]>;
}
declare function kadak(config: {
    url: string;
}): {
    schema(userSchema: SchemaDef): {
        push(): Promise<void>;
    };
    data<T = unknown>(queryInput: Record<string, unknown>): KadakDataPromise<T[]>;
    tx<T>(callback: (txClient: pg.PoolClient) => Promise<T>): Promise<T>;
    close(): Promise<void>;
};

export { type ASTNode, type AnalyzerWarning, type CanonicalColumn, type CanonicalRef, type CanonicalSchemaDef, type CanonicalTableDef, type ColumnDef, ColumnDefSchema, type Compiled, Compiler, type DBSchema, KadakClient, type KadakDataPromise, type Plan, Planner, type Predicate, type PredicateValue, type QueryAST, QueryBuilder, QueryInputSchema, type Ref, RefSchema, type Scalar, ScalarSchema, type ScalarValue, type SchemaDef, SchemaDefSchema, type TableDef, TableDefSchema, analyzePlan, kadak, normalizeColumn, normalizeRows, normalizeSchema, transaction, validateQueryInput, validateSchemaDef };

# Kadak

PostgreSQL data runtime with one explicit entry point.

## Install

```bash
npm install @shyk/kadak
```

## How Kadak Works

1. Define tables in modular files.
2. Export `dbClient` from `kadak.config.ts`.
3. Import `dbClient` everywhere and use it directly.

## Full Example

```typescript
import { kadak } from "@shyk/kadak"

const { types } = kadak

export const users = kadak.table({
  name: "users",
  columns: {
    name: types.string().min(2).max(80).lowercase().unique(),
    email: types.string().min(3).max(120).unique(),
    age: types.int().min(0).max(120),
    tags: types.array(types.string()),
    ...types.timestamps()
  }
})
```

```typescript
import { kadak } from "@shyk/kadak"

const { types } = kadak

export const posts = kadak.table({
  name: "posts",
  columns: {
    title: types.string().min(3).max(120),
    body: types.string().min(1),
    tags: types.array(types.string()),
    authorId: types.ref("users", { as: "author" }),
    ...types.timestamps()
  }
})
```

```typescript
import { kadak } from "@shyk/kadak"

const { types } = kadak

export const comments = kadak.table({
  name: "comments",
  columns: {
    body: types.string().min(1).max(500),
    postId: types.ref("posts", { as: "post" }),
    authorId: types.ref("users", { as: "author" }),
    ...types.timestamps()
  }
})
```

`kadak.config.ts`

```typescript
import { kadak } from "@shyk/kadak"

const db = kadak({ url: process.env.DATABASE_URL! })

const { types } = kadak

const users = kadak.table({
  name: "users",
  columns: {
    name: types.string().min(2).max(80).lowercase().unique(),
    email: types.string().min(3).max(120).unique(),
    age: types.int().min(0).max(120),
    tags: types.array(types.string()),
    ...types.timestamps()
  }
})

const posts = kadak.table({
  name: "posts",
  columns: {
    title: types.string().min(3).max(120),
    body: types.string().min(1),
    tags: types.array(types.string()),
    authorId: types.ref("users", { as: "author" }),
    ...types.timestamps()
  }
})

const comments = kadak.table({
  name: "comments",
  columns: {
    body: types.string().min(1).max(500),
    postId: types.ref("posts", { as: "post" }),
    authorId: types.ref("users", { as: "author" }),
    ...types.timestamps()
  }
})

const dbClient = db.define({ users, posts, comments })

export default dbClient
```

## Usage

```typescript
import dbClient from "@/kadak.config"

await dbClient.data({
  posts: {
    orderBy: { id: "desc" },
    author: true,
    comments: true
  }
})
```

## Relations (Explicit)

Use `types.ref("users", { as: "author" })` for schema.
Query with `author`, not `authorId`.
Kadak keeps relation names explicit and predictable.

## Metadata vs Constraints

`min`, `max`, and `lowercase` are metadata only.
`unique`, `notNull`, `default`, and `timestamps()` affect schema.
`types.array(...)` maps to `TEXT[]` or `INTEGER[]`.

## What Kadak Does Not Do

Kadak does not run runtime validation for `min` / `max` / `lowercase`.
Kadak does not guess relation names.
Kadak does not hide the `dbClient` entry point.

## Mutations

```typescript
await dbClient.insert("users", { name: "Alice", email: "alice@example.com" })

await dbClient.update("users", {
  where: { id: 1 },
  data: { name: "Bob" }
})

await dbClient.delete("users", { where: { id: 1 } })
```

## Debugging

```typescript
const q = dbClient.data({ posts: true })

console.log(q.toSQL())
await q.explain()
console.log(q.trace())
```

## CLI

```bash
npx kadak push
```

The CLI loads the default export from `kadak.config.ts` as `dbClient`.

## License

Apache-2.0

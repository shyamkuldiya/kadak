# Kadak

PostgreSQL data runtime with a single explicit entry point.

## Install

```bash
npm install @shyk/kadak
```

## How Kadak Works

1. Define tables in modular files.
2. Export `dbClient` from `kadak.config.ts`.
3. Import `dbClient` everywhere and use it directly.

## Tables

`tables/users.ts`

```typescript
import { kadak } from "@shyk/kadak"

const { types } = kadak

export const users = kadak.table({
  name: "users",
  columns: {
    name: types.string().notNull(),
    email: types.string().unique().notNull(),
    ...types.timestamps()
  }
})
```

## Config

`kadak.config.ts`

```typescript
import { kadak } from "@shyk/kadak"
import { users } from "./tables/users"

const db = kadak({ url: process.env.DATABASE_URL! })

export default db.define({ users })
```

## Usage

```typescript
import db from "@/kadak.config"

await db.data({
  users: true
})
```

## Relations

```typescript
import { kadak } from "@shyk/kadak"

const { types } = kadak

export const posts = kadak.table({
  name: "posts",
  columns: {
    title: types.string().notNull(),
    authorId: types.ref("users")
  }
})
```

Querying relations stays explicit:

```typescript
await db.data({
  posts: {
    authorId: true
  }
})
```

## Mutations

```typescript
await db.insert("users", { name: "Alice", email: "alice@example.com" })

await db.update("users", {
  where: { id: 1 },
  data: { name: "Bob" }
})

await db.delete("users", { where: { id: 1 } })
```

## Debugging

```typescript
const q = db.data({ users: true })

console.log(q.toSQL())
await q.explain()
console.log(q.trace())
```

## CLI

```bash
npx kadak push
```

The CLI loads the default export from `kadak.config.ts` and uses it as `dbClient`.

## License

Apache-2.0

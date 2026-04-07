import { kadak } from "../src/index.js";
import type { InferColumns } from "../src/index.js";

const db = kadak({ url: "postgres://localhost:5432/db" });

const users = kadak.table({
  name: "users",
  columns: {
    name: kadak.types.string(),
    email: kadak.types.string(),
    createdAt: kadak.types.timestamps().createdAt
  }
});

type UsersColumns = InferColumns<typeof users.columns>;
const usersColumnsCheck: UsersColumns = {
  name: "Alice",
  email: "alice@example.com",
  createdAt: "2026-01-01T00:00:00Z"
};

const posts = kadak.table({
  name: "posts",
  columns: {
    title: kadak.types.string(),
    body: kadak.types.text(),
    authorId: kadak.types.ref("users", { as: "author" })
  }
});

const typedDb = db.define({ users, posts });

const usersQuery = typedDb.data({
  users: true,
});

const usersResult: Promise<{
  users: Array<{
    id: number;
    name: string;
    email: string;
    createdAt: string;
    updatedAt: string;
  }>;
}> = usersQuery;

const postsQuery = typedDb.data({
  posts: {
    author: true
  }
});

const postsResult: Promise<{
  posts: Array<{
    id: number;
    title: string;
    body: string;
    authorId: number;
    author: {
      id: number;
      name: string;
      email: string;
      createdAt: string;
      updatedAt: string;
    };
    createdAt: string;
    updatedAt: string;
  }>;
}> = postsQuery;

typedDb.data({
  users: {
    where: {
      name: "Alice"
    },
    select: {
      name: true,
      email: true
    }
  }
});

// @ts-expect-error invalid table should fail
typedDb.data({ comments: {} });

// @ts-expect-error invalid field should fail
typedDb.data({ posts: { select: { nope: true } } });

// @ts-expect-error invalid where field should fail
typedDb.data({ users: { where: { nope: "x" } } });

// @ts-expect-error invalid insert table should fail
typedDb.insert("comments", {});

typedDb.insert("posts", {
  title: "Hello",
  body: "World",
  authorId: 1
});

// @ts-expect-error invalid mutation field should fail
typedDb.update("posts", { where: { id: 1 }, data: { nope: "x" } });

typedDb.delete("posts", {
  where: { id: 1 }
});

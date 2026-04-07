import { kadak } from "../src/index.js";

const db = kadak({ url: "postgres://localhost:5432/db" });

const users = kadak.table({
  name: "users",
  columns: {
    name: kadak.types.string(),
    email: kadak.types.string(),
    createdAt: kadak.types.timestamps().createdAt
  }
});

const posts = kadak.table({
  name: "posts",
  columns: {
    title: kadak.types.string(),
    body: kadak.types.text(),
    authorId: kadak.types.ref("users", { as: "author" })
  }
});

const typedDb = db.define({ users, posts });

typedDb.data({
  users: {
    select: {
      name: true,
      email: true
    }
  },
  posts: {
    select: {
      title: true,
      body: true
    },
    author: {
      select: {
        name: true,
        email: true
      }
    }
  }
});

// @ts-expect-error invalid table should fail
typedDb.data({ comments: {} });

// @ts-expect-error invalid field should fail
typedDb.data({ posts: { select: { nope: true } } });

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

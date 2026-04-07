import { describe, expect, it } from "vitest";
import { kadak } from "../src/index.js";

describe("nested pagination", () => {
  const db = kadak({ url: "postgres://localhost:5432/mock" });
  const posts = kadak.table({
    name: "posts",
    columns: {
      title: "string",
      comments: "comments.postId"
    }
  });
  const users = kadak.table({
    name: "users",
    columns: {
      name: "string"
    }
  });
  const comments = kadak.table({
    name: "comments",
    columns: {
      body: "string",
      postId: kadak.types.ref("posts", { as: "post" }),
      authorId: kadak.types.ref("users", { as: "author" })
    }
  });
  const dbClient = db.define({ posts, comments, users });

  it("throws when nested pagination is used", () => {
    expect(() => dbClient.data({
      posts: {
        comments: {
          take: 5
        }
      }
    } as never)).toThrow("Kadak Error: nested pagination is not supported yet");
  });
});

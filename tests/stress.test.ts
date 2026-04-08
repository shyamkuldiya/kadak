import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { kadak } from "../src/index.js";
import { runQuery } from "../src/exec/client.js";

const DB_URL = process.env.DATABASE_URL || "postgres://localhost:5432/mock";
const canRun = Boolean(process.env.DATABASE_URL);

const suite = canRun ? describe : describe.skip;

suite("stress and edge-case coverage", () => {
  const db = kadak({ url: DB_URL });

  const users = kadak.table({
    name: "users",
    columns: {
      name: "string",
      email: "string",
      posts: "posts.authorId"
    }
  });

  const posts = kadak.table({
    name: "posts",
    columns: {
      title: "string",
      body: "text",
      authorId: kadak.types.ref("users", { as: "author" }),
      comments: "comments.postId"
    }
  });

  const comments = kadak.table({
    name: "comments",
    columns: {
      content: "text",
      postId: kadak.types.ref("posts", { as: "post" }),
      authorId: kadak.types.ref("users", { as: "author" })
    }
  });

  const dbClient = db.define({ users, posts, comments });

  let userIds: number[] = [];
  let postIds: number[] = [];
  let commentRows: Array<{ id: number; postId: number; authorId: number | null }> = [];

  beforeAll(async () => {
    await dbClient.push();
    await runQuery("DELETE FROM comments", [], DB_URL);
    await runQuery("DELETE FROM posts", [], DB_URL);
    await runQuery("DELETE FROM users", [], DB_URL);

    userIds = [];
    postIds = [];
    commentRows = [];

    for (let i = 1; i <= 10; i++) {
      const rows = await runQuery(
        "INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id",
        [`User ${i}`, `user${i}@example.com`],
        DB_URL
      ) as Array<{ id: number }>;
      userIds.push(rows[0].id);
    }

    for (let i = 1; i <= 50; i++) {
      const authorId = userIds[i % userIds.length];
      const rows = await runQuery(
        "INSERT INTO posts (title, body, authorId) VALUES ($1, $2, $3) RETURNING id",
        [`Post ${i}`, `Body ${i}`, authorId],
        DB_URL
      ) as Array<{ id: number }>;
      postIds.push(rows[0].id);
    }

    const commentPlan = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55];
    for (let i = 0; i < postIds.length; i++) {
      const total = commentPlan[i % commentPlan.length] + (i % 3);
      for (let j = 0; j < total; j++) {
        const authorId = j % 7 === 0 ? null : userIds[(i + j) % userIds.length];
        const rows = await runQuery(
          "INSERT INTO comments (content, postId, authorId) VALUES ($1, $2, $3) RETURNING id, postId, authorId",
          [`Comment ${i + 1}-${j + 1}`, postIds[i], authorId],
          DB_URL
        ) as Array<{ id: number; postId: number; authorId: number | null }>;
        commentRows.push(rows[0]);
      }
    }
  }, 120000);

  afterAll(async () => {
    await runQuery("DELETE FROM comments", [], DB_URL).catch(() => {});
    await runQuery("DELETE FROM posts", [], DB_URL).catch(() => {});
    await runQuery("DELETE FROM users", [], DB_URL).catch(() => {});
    await db.close();
  }, 120000);

  it("deep nesting does not duplicate parents and nests authors correctly", async () => {
    const result = await dbClient.data({
      posts: {
        comments: {
          author: true
        }
      }
    });

    expect(result.length).toBe(postIds.length);
    expect(new Set(result.map((row) => row.id)).size).toBe(result.length);

    const withComments = result.find((row) => Array.isArray(row.comments) && row.comments.length > 0);
    expect(withComments).toBeTruthy();
    expect(withComments?.comments[0]).toHaveProperty("author");
  }, 120000);

  it("handles empty relations and null authors", async () => {
    const postWithNoComments = await dbClient.data({
      posts: {
        where: { id: postIds[0] },
        comments: true
      }
    });

    expect(postWithNoComments[0].comments).toEqual([]);

    const nullAuthorComment = await dbClient.data({
      comments: {
        where: {
          content: "Comment 1-1"
        },
        author: true
      }
    });

    expect(nullAuthorComment[0].author).toBeNull();
  }, 120000);

  it("supports mixed root query with relation count and select", async () => {
    const result = await dbClient.data({
      posts: {
        where: {},
        orderBy: { id: "desc" },
        take: 10,
        comments: {
          _count: true
        },
        author: {
          select: { id: true }
        }
      }
    });

    expect(result.length).toBe(10);
    expect(new Set(result.map((row) => row.id)).size).toBe(10);
    expect(result[0]).toHaveProperty("comments");
    expect(result[0].comments).toHaveProperty("_count");
    expect(result[0].author).toHaveProperty("id");
  }, 120000);

  it("keeps counts stable across the full dataset", async () => {
    const result = await dbClient.data({
      posts: {
        comments: {
          _count: true
        }
      }
    });

    const counts = result.map((row) => row.comments._count);
    expect(counts.length).toBe(postIds.length);
    expect(counts.every((count) => typeof count === "number")).toBe(true);
    expect(counts.some((count) => count === 0)).toBe(true);
    expect(counts.some((count) => count > 20)).toBe(true);
  }, 120000);

  it("returns rows with partial select plus relation count", async () => {
    const result = await dbClient.data({
      posts: {
        select: { title: true },
        comments: {
          _count: true
        },
        author: {
          select: { id: true }
        }
      }
    });

    expect(result.length).toBe(postIds.length);
    expect(result[0]).toHaveProperty("title");
    expect(result[0]).toHaveProperty("comments");
    expect(result[0].comments).toHaveProperty("_count");
    expect(result[0]).not.toHaveProperty("id");
  }, 120000);

  it("is deterministic across repeated execution", async () => {
    const baseline = await dbClient.data({
      posts: {
        where: { id: postIds[1] },
        comments: {
          _count: true
        },
        author: {
          select: { id: true }
        }
      }
    });

    for (let i = 0; i < 50; i++) {
      const next = await dbClient.data({
        posts: {
          where: { id: postIds[1] },
          comments: {
            _count: true
          },
          author: {
            select: { id: true }
          }
        }
      });
      expect(next).toEqual(baseline);
    }
  }, 120000);

  it("survives randomized query shapes", async () => {
    const shapes = [
      { where: { id: postIds[2] } },
      { select: { title: true } },
      { comments: { _count: true } },
      { author: { select: { id: true } } },
      { select: { title: true }, comments: { _count: true }, author: { select: { id: true } } }
    ];

    for (const shape of shapes) {
      const result = await dbClient.data({ posts: shape as any });
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    }
  }, 120000);
});

import { kadak } from "./src/index.js";
const { types } = kadak;

const db = kadak({
  url: process.env.DATABASE_URL || "postgres://localhost:5432/mock"
});

const users = kadak.table({
  name: "cli_test_users",
  columns: {
    name: types.string(),
    email: types.string().unique()
  }
});

export default db.define({ users });

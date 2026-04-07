import { kadak } from "./src/index.js";
const { types } = kadak;

const users = kadak.table({
  name: "cli_test_users",
  columns: {
    name: types.string(),
    email: types.string().unique()
  }
});

export default {
  url: process.env.DATABASE_URL || "postgres://localhost:5432/mock",
  schema: { users }
};

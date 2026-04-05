import { kadak } from "../src/index.js";
const { t } = kadak;

const users = kadak.table({
  name: "cli_test_users",
  columns: {
    name: t.string(),
    email: t.string().unique()
  }
});

export default {
  url: process.env.DATABASE_URL || "postgres://localhost:5432/mock",
  schema: { users }
};

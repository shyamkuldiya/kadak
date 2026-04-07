import { kadak } from "../src/index.js";

const { types } = kadak;

export const users = kadak.table({
  name: "cli_test_users",
  columns: {
    name: types.string(),
    email: types.string().unique()
  }
});

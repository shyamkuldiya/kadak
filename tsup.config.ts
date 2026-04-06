import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli/index.ts", "src/exec/client.ts"],
  format: ["esm", "cjs"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
});

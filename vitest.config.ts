import { defineConfig } from "vitest/config";
import path from "path";

/**
 * Vitest configuration — server-side unit tests only. The React client has its
 * own testing story (Playwright, etc.); this config targets Node modules in
 * `server/` and `shared/`.
 *
 * Path aliases mirror tsconfig.json so imports like `@shared/contracts` work
 * the same way inside tests as they do at runtime.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client", "src"),
    },
  },
  test: {
    // Only run explicit unit tests under server/ (and never touch node_modules).
    include: ["server/**/*.{test,spec}.ts", "shared/**/*.{test,spec}.ts"],
    exclude: ["node_modules/**", "dist/**", "build/**", "client/**"],
    environment: "node",
    globals: false,
    coverage: {
      reporter: ["text", "html"],
      include: ["server/**/*.ts", "shared/**/*.ts"],
      exclude: [
        "server/**/*.test.ts",
        "server/index.ts",
        "server/static.ts",
        "server/vite.ts",
        "**/*.d.ts",
      ],
    },
  },
});

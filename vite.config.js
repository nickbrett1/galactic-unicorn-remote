import { sveltekit } from "@sveltejs/kit/vite";
import { svelteTesting } from "@testing-library/svelte/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit(), svelteTesting()],
  // The commit the image was built from, stamped at build time. It is a
  // *define* rather than an env var so the number is baked into the bundle
  // instead of depending on a runtime environment that the container does not
  // set. "dev" is what a checkout, a test run or a local `vite dev` reports,
  // and that is the truthful answer for those.
  define: {
    __NB_BUILD__: JSON.stringify(process.env.NB_BUILD_COMMIT || "dev"),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/test-setup.js"],
    reporter: ["default", "junit"],
    outputFile: {
      junit: "./reports/junit.xml",
    },
    coverage: {
      reporter: ["lcov", "text"],
      thresholds: {
        statements: 80,
        branches: 50,
        functions: 80,
        lines: 80,
      },
    },
  },
});

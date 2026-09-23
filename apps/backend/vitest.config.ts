import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // Dummy values: db/index.ts throws without DATABASE_URL, and the
    // Supabase client is constructed at import time. Nothing here is ever
    // connected to -- test/setup.ts swaps both for in-process fakes.
    env: {
      DATABASE_URL: "postgres://test:test@localhost:5432/test",
      SUPABASE_URL: "http://supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    },
  },
})

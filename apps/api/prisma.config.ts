import { defineConfig } from "prisma/config";

const placeholderDatabaseUrl = "postgresql://USER:PASSWORD@HOST:5432/edvora";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? placeholderDatabaseUrl,
  },
});

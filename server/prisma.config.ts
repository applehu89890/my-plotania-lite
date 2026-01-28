// server/prisma.config.ts
import { defineConfig } from "prisma/config";

export default {
  schema: "prisma/schema.prisma",
  engineType: "binary",
};

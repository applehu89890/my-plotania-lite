import { defineConfig } from "prisma/config";

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error("Missing DATABASE_URL for Prisma");
}

export default defineConfig({
  datasource: {
    // ✅ 兼容 Prisma 7 不同命令的读取方式
    url,
    db: { url },
  },
});

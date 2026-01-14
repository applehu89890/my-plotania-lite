// server/prisma.config.ts
import { defineConfig } from "@prisma/config";

export default defineConfig({
  // 你的 schema 文件位置
  schema: "prisma/schema.prisma",

  // 👇 这里就是 CLI 报错里说的那个 datasource（单数）
  datasource: {
    // 对于 SQLite，直接用 file: 前缀指向一个本地文件
    url: "file:./dev.db",
  },
});

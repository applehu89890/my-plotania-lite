-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LogEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "documentId" TEXT,
    "eventType" TEXT NOT NULL,
    "toolName" TEXT,
    "selectionStart" INTEGER,
    "selectionEnd" INTEGER,
    "docLength" INTEGER,
    "payloadJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_LogEvent" ("createdAt", "docLength", "documentId", "eventType", "id", "payloadJson", "selectionEnd", "selectionStart", "sessionId", "toolName") SELECT "createdAt", "docLength", "documentId", "eventType", "id", "payloadJson", "selectionEnd", "selectionStart", "sessionId", "toolName" FROM "LogEvent";
DROP TABLE "LogEvent";
ALTER TABLE "new_LogEvent" RENAME TO "LogEvent";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_LogEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sessionId" TEXT NOT NULL,
    "documentId" TEXT,
    "eventType" TEXT NOT NULL,
    "toolName" TEXT,
    "selectionStart" INTEGER,
    "selectionEnd" INTEGER,
    "docLength" INTEGER,
    "payloadJson" TEXT,
    CONSTRAINT "LogEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LogEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_LogEvent" ("createdAt", "docLength", "documentId", "eventType", "id", "payloadJson", "selectionEnd", "selectionStart", "sessionId", "toolName") SELECT "createdAt", "docLength", "documentId", "eventType", "id", "payloadJson", "selectionEnd", "selectionStart", "sessionId", "toolName" FROM "LogEvent";
DROP TABLE "LogEvent";
ALTER TABLE "new_LogEvent" RENAME TO "LogEvent";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE TABLE "ContextSummary" (
    "id" TEXT NOT NULL,
    "subjectRevisionId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "body" JSONB NOT NULL,
    "throughMessageId" TEXT NOT NULL,
    "throughCreatedAt" TIMESTAMP(3) NOT NULL,
    "coveredMessages" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContextSummary_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContextSummary_subjectRevisionId_scopeKey_key" ON "ContextSummary"("subjectRevisionId", "scopeKey");
ALTER TABLE "ContextSummary" ADD CONSTRAINT "ContextSummary_subjectRevisionId_fkey" FOREIGN KEY ("subjectRevisionId") REFERENCES "SubjectRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

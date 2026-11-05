BEGIN;
-- DropIndex
DROP INDEX "SubjectRevision_conversationId_version_key";

-- DropIndex
DROP INDEX "LearningProgress_conversationId_key";

-- DropIndex
DROP INDEX "CollectionEntry_conversationId_key";

-- DropIndex
DROP INDEX "CollectionEntry_userId_conversationId_key";

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "activeSubjectId" TEXT,
ADD COLUMN     "learnAll" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SubjectRevision" ADD COLUMN     "subjectId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "subjectId" TEXT;

-- AlterTable
ALTER TABLE "LearningProgress" ADD COLUMN     "destination" TEXT NOT NULL DEFAULT 'chat',
ADD COLUMN     "draft" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "subjectId" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "CollectionEntry" ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "subjectId" TEXT;

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "subjectId" TEXT;

-- AlterTable
ALTER TABLE "GenerationJob" ADD COLUMN     "subjectId" TEXT;

-- CreateTable
CREATE TABLE "LearningSubject" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningSubject_pkey" PRIMARY KEY ("id")
);

-- Preserve every legacy conversation as its first stable learning object.
-- Do not infer multiple objects from revision history or discard old records.
INSERT INTO "LearningSubject" ("id", "conversationId", "order", "createdAt")
SELECT 'legacy_' || "id", "id", 0, "createdAt" FROM "Conversation";
UPDATE "Conversation" SET "activeSubjectId" = 'legacy_' || "id";
UPDATE "SubjectRevision" SET "subjectId" = 'legacy_' || "conversationId";
ALTER TABLE "SubjectRevision" ALTER COLUMN "subjectId" SET NOT NULL;
UPDATE "Message" SET "subjectId" = 'legacy_' || "conversationId";
ALTER TABLE "Message" ALTER COLUMN "subjectId" SET NOT NULL;
UPDATE "LearningProgress" SET "subjectId" = 'legacy_' || "conversationId";
ALTER TABLE "LearningProgress" ALTER COLUMN "subjectId" SET NOT NULL;
UPDATE "CollectionEntry" SET "subjectId" = 'legacy_' || "conversationId";
ALTER TABLE "CollectionEntry" ALTER COLUMN "subjectId" SET NOT NULL;
UPDATE "AgentRun" SET "subjectId" = 'legacy_' || "conversationId";
ALTER TABLE "AgentRun" ALTER COLUMN "subjectId" SET NOT NULL;
UPDATE "GenerationJob" SET "subjectId" = 'legacy_' || "conversationId";
ALTER TABLE "GenerationJob" ALTER COLUMN "subjectId" SET NOT NULL;
INSERT INTO "LearningProgress" ("id", "conversationId", "subjectId", "updatedAt")
SELECT 'legacy_progress_' || c."id", c."id", c."activeSubjectId", CURRENT_TIMESTAMP
FROM "Conversation" c WHERE NOT EXISTS (SELECT 1 FROM "LearningProgress" p WHERE p."conversationId" = c."id");

-- CreateIndex
CREATE UNIQUE INDEX "LearningSubject_conversationId_order_key" ON "LearningSubject"("conversationId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectRevision_subjectId_version_key" ON "SubjectRevision"("subjectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgress_subjectId_key" ON "LearningProgress"("subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionEntry_userId_subjectId_key" ON "CollectionEntry"("userId", "subjectId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_activeSubjectId_fkey" FOREIGN KEY ("activeSubjectId") REFERENCES "LearningSubject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSubject" ADD CONSTRAINT "LearningSubject_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectRevision" ADD CONSTRAINT "SubjectRevision_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "LearningSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "LearningSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "LearningSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionEntry" ADD CONSTRAINT "CollectionEntry_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "LearningSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "LearningSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "LearningSubject"("id") ON DELETE CASCADE ON UPDATE CASCADE;


COMMIT;

ALTER TABLE "PracticeAttempt"
  ADD COLUMN "redoOfAttemptId" TEXT,
  ADD COLUMN "redoRequestId" TEXT,
  ADD COLUMN "redoMode" TEXT;
CREATE UNIQUE INDEX "PracticeAttempt_userId_redoRequestId_key" ON "PracticeAttempt"("userId", "redoRequestId");

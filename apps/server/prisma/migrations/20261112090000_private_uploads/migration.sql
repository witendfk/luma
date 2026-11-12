ALTER TABLE "Attachment"
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN "storageProvider" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "uploadExpiresAt" TIMESTAMP(3),
  ADD COLUMN "scope" JSONB;
CREATE INDEX "Attachment_userId_status_idx" ON "Attachment"("userId", "status");

-- CreateEnum
CREATE TYPE "SubjectType" AS ENUM ('question', 'knowledge');

-- CreateEnum
CREATE TYPE "TeachingStage" AS ENUM ('clarifying', 'guiding', 'explaining', 'practicing', 'reviewing');

-- CreateEnum
CREATE TYPE "PracticeStage" AS ENUM ('intro', 'doing', 'review', 'summary');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'superseded');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('lesson', 'exercise_set');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('generating', 'published', 'failed');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('complete', 'incomplete');

-- CreateEnum
CREATE TYPE "SelfEval" AS ENUM ('independent', 'partial', 'stuck');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('to_review', 'reviewed');

-- CreateEnum
CREATE TYPE "AttachmentPurpose" AS ENUM ('question_origin', 'process_photo', 'answer_photo', 'lesson_illustration', 'knowledge_material');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "openid" TEXT NOT NULL,
    "nickname" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '新对话',
    "archivedAt" TIMESTAMP(3),
    "lastActiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubjectRevision" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "type" "SubjectType" NOT NULL,
    "content" JSONB NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subquestions" JSONB,
    "activeSubquestionIndex" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "originAttachmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubjectRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessTranscript" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "subjectRevisionId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "confirmedSteps" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessTranscript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" JSONB NOT NULL,
    "subjectRevisionId" TEXT,
    "requestId" TEXT,
    "status" "MessageStatus" NOT NULL DEFAULT 'complete',
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningProgress" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "stage" "TeachingStage" NOT NULL DEFAULT 'clarifying',
    "subjectRevisionId" TEXT,
    "currentArtifactId" TEXT,
    "currentSectionId" TEXT,
    "currentAttemptId" TEXT,
    "currentExerciseId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "subjectRevisionId" TEXT NOT NULL,
    "type" "ArtifactType" NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "publishStatus" "PublishStatus" NOT NULL DEFAULT 'generating',
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "stem" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "analysis" TEXT NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeAttempt" (
    "id" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseIds" JSONB NOT NULL,
    "stage" "PracticeStage" NOT NULL DEFAULT 'intro',
    "currentExerciseId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeAnswer" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "textDraft" TEXT,
    "photoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "markedUnknown" BOOLEAN NOT NULL DEFAULT false,
    "hintsUsed" INTEGER NOT NULL DEFAULT 0,
    "solutionViewedAt" TIMESTAMP(3),
    "selfEval" "SelfEval",
    "draftVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PracticeAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "note" TEXT,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'to_review',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CollectionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "previewObjectKey" TEXT,
    "purpose" "AttachmentPurpose" NOT NULL,
    "format" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "subjectRevisionId" TEXT,
    "requestId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "promptVersion" TEXT NOT NULL,
    "taskFrame" JSONB,
    "protocol" JSONB,
    "pendingBatch" JSONB,
    "waitingJobIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "counters" JSONB,
    "policySnapshot" JSONB,
    "inputDigest" TEXT,
    "deadlineAt" TIMESTAMP(3),
    "retryOfRunId" TEXT,
    "userMessageId" TEXT,
    "leaseBy" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "usage" JSONB,
    "error" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "toolCallId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "batchOrder" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "idempotencyKey" TEXT,
    "paramsDigest" JSONB,
    "resultRef" JSONB,
    "error" JSONB,
    "durationMs" INTEGER,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "runId" TEXT,
    "type" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "subjectRevisionId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "step" TEXT,
    "resultArtifactId" TEXT,
    "payload" JSONB,
    "counters" JSONB,
    "deadlineAt" TIMESTAMP(3),
    "draftCheckpoint" JSONB,
    "retryOfJobId" TEXT,
    "idempotencyKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" JSONB,
    "leasedBy" TEXT,
    "leasedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_openid_key" ON "User"("openid");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "Conversation_userId_lastActiveAt_idx" ON "Conversation"("userId", "lastActiveAt");

-- CreateIndex
CREATE INDEX "Conversation_userId_archivedAt_idx" ON "Conversation"("userId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectRevision_conversationId_version_key" ON "SubjectRevision"("conversationId", "version");

-- CreateIndex
CREATE INDEX "ProcessTranscript_conversationId_idx" ON "ProcessTranscript"("conversationId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Message_conversationId_requestId_key" ON "Message"("conversationId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgress_conversationId_key" ON "LearningProgress"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgress_currentArtifactId_key" ON "LearningProgress"("currentArtifactId");

-- CreateIndex
CREATE INDEX "Artifact_conversationId_idx" ON "Artifact"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_conversationId_subjectRevisionId_type_version_key" ON "Artifact"("conversationId", "subjectRevisionId", "type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_artifactId_order_key" ON "Exercise"("artifactId", "order");

-- CreateIndex
CREATE INDEX "PracticeAttempt_userId_createdAt_idx" ON "PracticeAttempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PracticeAttempt_artifactId_userId_idx" ON "PracticeAttempt"("artifactId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PracticeAnswer_attemptId_exerciseId_key" ON "PracticeAnswer"("attemptId", "exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionEntry_conversationId_key" ON "CollectionEntry"("conversationId");

-- CreateIndex
CREATE INDEX "CollectionEntry_userId_reviewStatus_idx" ON "CollectionEntry"("userId", "reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionEntry_userId_conversationId_key" ON "CollectionEntry"("userId", "conversationId");

-- CreateIndex
CREATE INDEX "AgentRun_conversationId_startedAt_idx" ON "AgentRun"("conversationId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentRun_status_leaseUntil_idx" ON "AgentRun"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_conversationId_requestId_key" ON "AgentRun"("conversationId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolExecution_idempotencyKey_key" ON "ToolExecution"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ToolExecution_runId_decisionId_idx" ON "ToolExecution"("runId", "decisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ToolExecution_runId_toolCallId_key" ON "ToolExecution"("runId", "toolCallId");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationJob_idempotencyKey_key" ON "GenerationJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GenerationJob_status_createdAt_idx" ON "GenerationJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectRevision" ADD CONSTRAINT "SubjectRevision_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectRevision" ADD CONSTRAINT "SubjectRevision_originAttachmentId_fkey" FOREIGN KEY ("originAttachmentId") REFERENCES "Attachment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessTranscript" ADD CONSTRAINT "ProcessTranscript_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessTranscript" ADD CONSTRAINT "ProcessTranscript_subjectRevisionId_fkey" FOREIGN KEY ("subjectRevisionId") REFERENCES "SubjectRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessTranscript" ADD CONSTRAINT "ProcessTranscript_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "Attachment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_subjectRevisionId_fkey" FOREIGN KEY ("subjectRevisionId") REFERENCES "SubjectRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_subjectRevisionId_fkey" FOREIGN KEY ("subjectRevisionId") REFERENCES "SubjectRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_currentArtifactId_fkey" FOREIGN KEY ("currentArtifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_subjectRevisionId_fkey" FOREIGN KEY ("subjectRevisionId") REFERENCES "SubjectRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeAttempt" ADD CONSTRAINT "PracticeAttempt_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeAttempt" ADD CONSTRAINT "PracticeAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeAnswer" ADD CONSTRAINT "PracticeAnswer_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PracticeAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeAnswer" ADD CONSTRAINT "PracticeAnswer_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionEntry" ADD CONSTRAINT "CollectionEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionEntry" ADD CONSTRAINT "CollectionEntry_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_subjectRevisionId_fkey" FOREIGN KEY ("subjectRevisionId") REFERENCES "SubjectRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userMessageId_fkey" FOREIGN KEY ("userMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_subjectRevisionId_fkey" FOREIGN KEY ("subjectRevisionId") REFERENCES "SubjectRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

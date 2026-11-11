-- CreateTable
CREATE TABLE "LearningRoute" (
    "id" TEXT NOT NULL,
    "subjectRevisionId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "contentProfileId" TEXT NOT NULL,
    "contentProfileVersion" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "sourceQuote" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningRouteNode" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "objective" TEXT NOT NULL,
    "prerequisites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "passCriteria" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningRouteNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningCheck" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "sourceRunId" TEXT NOT NULL,
    "issuedMessageId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "taskKind" TEXT NOT NULL,
    "rubricVersion" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "supportLevel" TEXT NOT NULL DEFAULT 'independent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningCheckEvaluation" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "attemptMessageId" TEXT NOT NULL,
    "answerSnapshot" TEXT NOT NULL,
    "evaluation" TEXT NOT NULL,
    "supportLevel" TEXT NOT NULL,
    "criteriaResults" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningCheckEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningRouteEvent" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningRouteEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearningRoute_sourceRunId_key" ON "LearningRoute"("sourceRunId");

-- CreateIndex
CREATE INDEX "LearningRoute_subjectRevisionId_createdAt_idx" ON "LearningRoute"("subjectRevisionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningRouteNode_routeId_key_key" ON "LearningRouteNode"("routeId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "LearningRouteNode_routeId_position_key" ON "LearningRouteNode"("routeId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "LearningCheck_sourceRunId_key" ON "LearningCheck"("sourceRunId");

-- CreateIndex
CREATE INDEX "LearningCheck_nodeId_createdAt_idx" ON "LearningCheck"("nodeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LearningCheckEvaluation_checkId_runId_key" ON "LearningCheckEvaluation"("checkId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningCheckEvaluation_checkId_attemptMessageId_key" ON "LearningCheckEvaluation"("checkId", "attemptMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningRouteEvent_requestId_key" ON "LearningRouteEvent"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "LearningRouteEvent_routeId_version_key" ON "LearningRouteEvent"("routeId", "version");

-- AddForeignKey
ALTER TABLE "LearningRoute" ADD CONSTRAINT "LearningRoute_subjectRevisionId_fkey" FOREIGN KEY ("subjectRevisionId") REFERENCES "SubjectRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningRouteNode" ADD CONSTRAINT "LearningRouteNode_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "LearningRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningCheck" ADD CONSTRAINT "LearningCheck_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "LearningRouteNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningCheckEvaluation" ADD CONSTRAINT "LearningCheckEvaluation_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "LearningCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningRouteEvent" ADD CONSTRAINT "LearningRouteEvent_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "LearningRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;


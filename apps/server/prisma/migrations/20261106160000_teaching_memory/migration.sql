CREATE TABLE "TeachingMemory" (
  "id" TEXT PRIMARY KEY, "subjectRevisionId" TEXT NOT NULL,
  "scope" JSONB NOT NULL, "scopeKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL, "text" TEXT NOT NULL, "sourceKind" TEXT NOT NULL,
  "evidence" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'candidate',
  "supersedesId" TEXT, "containsSolution" BOOLEAN NOT NULL DEFAULT false,
  "verificationRef" TEXT, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeachingMemory_subjectRevisionId_fkey" FOREIGN KEY ("subjectRevisionId") REFERENCES "SubjectRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "TeachingMemory_subjectRevisionId_status_scopeKey_idx" ON "TeachingMemory"("subjectRevisionId", "status", "scopeKey");
-- Preserve legacy JSON and provenance verbatim. No invented quotes or verified conclusions.
INSERT INTO "TeachingMemory" ("id", "subjectRevisionId", "scope", "scopeKey", "kind", "text", "sourceKind", "evidence", "containsSolution")
SELECT 'legacy:' || r.id || ':' || n.ordinality, r.id,
  COALESCE(n.note->'focus', '{}'::jsonb), 'legacy',
  CASE WHEN n.note->>'kind' = 'openQuestion' THEN 'open_question' ELSE n.note->>'kind' END,
  n.note->>'text', 'model_inference',
  jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('messageId', n.note->>'messageId', 'userMessageId', n.note->>'userMessageId', 'artifactId', n.note->>'artifactId', 'sectionId', n.note->>'sectionId', 'legacy', true))),
  COALESCE((n.note->>'containsSolution')::boolean, false)
FROM "SubjectRevision" r CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r."teachingState"->'notes') = 'array' THEN r."teachingState"->'notes' ELSE '[]'::jsonb END) WITH ORDINALITY n(note, ordinality)
WHERE n.note->>'kind' IN ('difficulty', 'method', 'openQuestion') AND n.note->>'text' IS NOT NULL;

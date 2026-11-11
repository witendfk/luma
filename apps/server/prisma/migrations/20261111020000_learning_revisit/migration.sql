ALTER TABLE "LearningRoute" ADD COLUMN "currentNodeId" TEXT;
ALTER TABLE "LearningCheck" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';

UPDATE "LearningRoute" AS route SET "currentNodeId" = (
  SELECT node.id FROM "LearningRouteNode" AS node
  WHERE node."routeId" = route.id AND node.status IN ('learning', 'needs_review', 'pending')
  ORDER BY CASE WHEN node.status = 'pending' THEN 1 ELSE 0 END, node.position
  LIMIT 1
);

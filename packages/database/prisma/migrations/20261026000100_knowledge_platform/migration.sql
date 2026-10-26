BEGIN;
-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "workflow" JSONB;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "estimateMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "parentId" UUID,
ADD COLUMN     "sprintId" UUID,
ADD COLUMN     "startsAt" TIMESTAMPTZ(3),
ADD COLUMN     "storyPoints" INTEGER;
-- Preserve all existing task statuses while allowing project-specific workflows.
ALTER TABLE "Task" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Task" ALTER COLUMN "status" TYPE VARCHAR(40) USING "status"::text;
ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'NEW';

-- CreateTable
CREATE TABLE "KnowledgeSpace" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "key" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpaceMember" (
    "spaceId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "ProjectMemberRole" NOT NULL DEFAULT 'MEMBER',

    CONSTRAINT "SpaceMember_pkey" PRIMARY KEY ("spaceId","userId")
);

-- CreateTable
CREATE TABLE "KnowledgePage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "parentId" UUID,
    "authorId" UUID NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}',
    "text" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMPTZ(3),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KnowledgePage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageRevision" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageDraft" (
    "pageId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PageDraft_pkey" PRIMARY KEY ("pageId","userId")
);

-- CreateTable
CREATE TABLE "PageComment" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageTaskLink" (
    "pageId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,

    CONSTRAINT "PageTaskLink_pkey" PRIMARY KEY ("pageId","taskId")
);

-- CreateTable
CREATE TABLE "Sprint" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "result" JSONB,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "label" VARCHAR(500) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "taskId" UUID NOT NULL,
    "dependsOnId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("taskId","dependsOnId")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTimer" (
    "userId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTimer_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "TaskWatch" (
    "taskId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "TaskWatch_pkey" PRIMARY KEY ("taskId","userId")
);

-- CreateTable
CREATE TABLE "StorageAttachment" (
    "objectId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "taskId" UUID,
    "pageId" UUID,

    CONSTRAINT "StorageAttachment_pkey" PRIMARY KEY ("objectId")
);

-- CreateTable
CREATE TABLE "StorageUpload" (
    "id" UUID NOT NULL,
    "objectId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "expectedSize" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "StorageUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageQuota" (
    "organizationId" UUID NOT NULL,
    "bytes" BIGINT NOT NULL DEFAULT 10737418240,

    CONSTRAINT "StorageQuota_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "taskId" UUID,
    "pageId" UUID,
    "eventKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "href" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPreferences" (
    "userId" UUID NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "widgets" TEXT[] DEFAULT ARRAY['tasks', 'projects', 'knowledge', 'activity']::TEXT[],

    CONSTRAINT "UserPreferences_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "OrganizationSettings" (
    "organizationId" UUID NOT NULL,
    "smtpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smtpHost" TEXT NOT NULL DEFAULT '',
    "smtpPort" INTEGER NOT NULL DEFAULT 465,
    "smtpMode" TEXT NOT NULL DEFAULT 'TLS',
    "smtpUser" TEXT NOT NULL DEFAULT '',
    "smtpSecret" TEXT,
    "senderEmail" TEXT NOT NULL DEFAULT '',
    "senderName" TEXT NOT NULL DEFAULT 'Ventilyator',
    "imapEnabled" BOOLEAN NOT NULL DEFAULT false,
    "imapHost" TEXT NOT NULL DEFAULT '',
    "imapPort" INTEGER NOT NULL DEFAULT 993,
    "imapDomain" TEXT,
    "imapAutoCreate" BOOLEAN NOT NULL DEFAULT false,
    "imapRoleId" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSpace_organizationId_key_key" ON "KnowledgeSpace"("organizationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSpace_id_organizationId_key" ON "KnowledgeSpace"("id", "organizationId");

-- CreateIndex
CREATE INDEX "SpaceMember_userId_organizationId_idx" ON "SpaceMember"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "KnowledgePage_spaceId_archived_parentId_idx" ON "KnowledgePage"("spaceId", "archived", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePage_id_organizationId_key" ON "KnowledgePage"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgePage_id_spaceId_organizationId_key" ON "KnowledgePage"("id", "spaceId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "PageRevision_pageId_number_key" ON "PageRevision"("pageId", "number");

-- CreateIndex
CREATE INDEX "PageComment_pageId_createdAt_idx" ON "PageComment"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "Sprint_projectId_status_idx" ON "Sprint"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Sprint_id_projectId_organizationId_key" ON "Sprint"("id", "projectId", "organizationId");

-- CreateIndex
CREATE INDEX "TimeEntry_taskId_startedAt_idx" ON "TimeEntry"("taskId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTimer_userId_organizationId_key" ON "TaskTimer"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "StorageAttachment_objectId_organizationId_key" ON "StorageAttachment"("objectId", "organizationId");

-- CreateIndex
CREATE INDEX "StorageUpload_organizationId_status_idx" ON "StorageUpload"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StorageUpload_objectId_number_key" ON "StorageUpload"("objectId", "number");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_eventKey_key" ON "Notification"("userId", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_notificationId_key" ON "EmailDelivery"("notificationId");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_createdAt_idx" ON "EmailDelivery"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationSettings_imapDomain_key" ON "OrganizationSettings"("imapDomain");

-- CreateIndex
CREATE UNIQUE INDEX "StorageObject_id_organizationId_key" ON "StorageObject"("id", "organizationId");

-- CreateIndex
-- Existing status index is preserved by ALTER TYPE.

-- CreateIndex
-- Existing assignee/status index is preserved by ALTER TYPE.

-- CreateIndex
CREATE UNIQUE INDEX "Task_id_projectId_organizationId_key" ON "Task"("id", "projectId", "organizationId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentId_projectId_organizationId_fkey" FOREIGN KEY ("parentId", "projectId", "organizationId") REFERENCES "Task"("id", "projectId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_sprintId_projectId_organizationId_fkey" FOREIGN KEY ("sprintId", "projectId", "organizationId") REFERENCES "Sprint"("id", "projectId", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSpace" ADD CONSTRAINT "KnowledgeSpace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSpace" ADD CONSTRAINT "KnowledgeSpace_ownerId_organizationId_fkey" FOREIGN KEY ("ownerId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_spaceId_organizationId_fkey" FOREIGN KEY ("spaceId", "organizationId") REFERENCES "KnowledgeSpace"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpaceMember" ADD CONSTRAINT "SpaceMember_userId_organizationId_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePage" ADD CONSTRAINT "KnowledgePage_spaceId_organizationId_fkey" FOREIGN KEY ("spaceId", "organizationId") REFERENCES "KnowledgeSpace"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePage" ADD CONSTRAINT "KnowledgePage_parentId_spaceId_organizationId_fkey" FOREIGN KEY ("parentId", "spaceId", "organizationId") REFERENCES "KnowledgePage"("id", "spaceId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgePage" ADD CONSTRAINT "KnowledgePage_authorId_organizationId_fkey" FOREIGN KEY ("authorId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageRevision" ADD CONSTRAINT "PageRevision_pageId_organizationId_fkey" FOREIGN KEY ("pageId", "organizationId") REFERENCES "KnowledgePage"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageRevision" ADD CONSTRAINT "PageRevision_authorId_organizationId_fkey" FOREIGN KEY ("authorId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageDraft" ADD CONSTRAINT "PageDraft_pageId_organizationId_fkey" FOREIGN KEY ("pageId", "organizationId") REFERENCES "KnowledgePage"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageDraft" ADD CONSTRAINT "PageDraft_userId_organizationId_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageComment" ADD CONSTRAINT "PageComment_pageId_organizationId_fkey" FOREIGN KEY ("pageId", "organizationId") REFERENCES "KnowledgePage"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageComment" ADD CONSTRAINT "PageComment_authorId_organizationId_fkey" FOREIGN KEY ("authorId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageTaskLink" ADD CONSTRAINT "PageTaskLink_pageId_organizationId_fkey" FOREIGN KEY ("pageId", "organizationId") REFERENCES "KnowledgePage"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageTaskLink" ADD CONSTRAINT "PageTaskLink_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Task"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "Project"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Task"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Task"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnId_organizationId_fkey" FOREIGN KEY ("dependsOnId", "organizationId") REFERENCES "Task"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Task"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_organizationId_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimer" ADD CONSTRAINT "TaskTimer_userId_organizationId_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTimer" ADD CONSTRAINT "TaskTimer_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Task"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWatch" ADD CONSTRAINT "TaskWatch_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Task"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWatch" ADD CONSTRAINT "TaskWatch_userId_organizationId_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageAttachment" ADD CONSTRAINT "StorageAttachment_objectId_organizationId_fkey" FOREIGN KEY ("objectId", "organizationId") REFERENCES "StorageObject"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageAttachment" ADD CONSTRAINT "StorageAttachment_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Task"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageAttachment" ADD CONSTRAINT "StorageAttachment_pageId_organizationId_fkey" FOREIGN KEY ("pageId", "organizationId") REFERENCES "KnowledgePage"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageUpload" ADD CONSTRAINT "StorageUpload_objectId_organizationId_fkey" FOREIGN KEY ("objectId", "organizationId") REFERENCES "StorageObject"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageUpload" ADD CONSTRAINT "StorageUpload_userId_organizationId_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageQuota" ADD CONSTRAINT "StorageQuota_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_organizationId_fkey" FOREIGN KEY ("userId", "organizationId") REFERENCES "User"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_taskId_organizationId_fkey" FOREIGN KEY ("taskId", "organizationId") REFERENCES "Task"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_pageId_organizationId_fkey" FOREIGN KEY ("pageId", "organizationId") REFERENCES "KnowledgePage"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPreferences" ADD CONSTRAINT "UserPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT "OrganizationSettings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "StorageAttachment" ADD CONSTRAINT "StorageAttachment_one_context" CHECK (("taskId" IS NOT NULL)::int + ("pageId" IS NOT NULL)::int = 1);
ALTER TABLE "StorageUpload" ADD CONSTRAINT "StorageUpload_size_check" CHECK ("expectedSize" > 0 AND "expectedSize" <= 26214400);
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_minutes_check" CHECK (minutes > 0 AND minutes <= 10080);
CREATE UNIQUE INDEX "Sprint_one_active_per_project" ON "Sprint" ("projectId") WHERE status = 'ACTIVE';
CREATE INDEX "Task_search_ru" ON "Task" USING GIN (to_tsvector('russian', title || ' ' || description));
CREATE INDEX "Task_search_simple" ON "Task" USING GIN (to_tsvector('simple', title || ' ' || description));
CREATE INDEX "KnowledgePage_search_ru" ON "KnowledgePage" USING GIN (to_tsvector('russian', title || ' ' || text));
CREATE INDEX "KnowledgePage_search_simple" ON "KnowledgePage" USING GIN (to_tsvector('simple', title || ' ' || text));
INSERT INTO "Permission" (key) VALUES ('knowledge:create'),('knowledge:manage'),('mail:manage'),('storage:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", permission) SELECT r.id,p.key FROM "Role" r CROSS JOIN "Permission" p WHERE r.name IN ('System Administrator','Organization Administrator') AND p.key IN ('knowledge:create','knowledge:manage','mail:manage','storage:manage') ON CONFLICT DO NOTHING;
INSERT INTO "RolePermission" ("roleId", permission) SELECT id,'knowledge:create' FROM "Role" WHERE name IN ('Department Manager','Project Administrator','Team Member') ON CONFLICT DO NOTHING;
COMMIT;

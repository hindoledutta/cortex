-- CreateEnum
CREATE TYPE "meeting_source" AS ENUM ('meetily');

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "attendee_emails" TEXT[],
    "transcript" TEXT NOT NULL,
    "source" "meeting_source" NOT NULL,
    "external_id" TEXT,
    "vault_path" TEXT NOT NULL,
    "vault_commit_sha" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "heartbeats" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "version" TEXT,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "last_ingest_at" TIMESTAMP(3),
    "queue_depth" INTEGER,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "heartbeats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_workspace_id_created_at_idx" ON "meetings"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "meetings_started_at_idx" ON "meetings"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "meeting_external_id_unique" ON "meetings"("source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "heartbeats_host_key" ON "heartbeats"("host");

-- CreateIndex
CREATE INDEX "heartbeats_last_seen_at_idx" ON "heartbeats"("last_seen_at");

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

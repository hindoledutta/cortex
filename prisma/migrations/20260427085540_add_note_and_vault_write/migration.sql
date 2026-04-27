-- CreateEnum
CREATE TYPE "NoteSource" AS ENUM ('text', 'voice');

-- CreateEnum
CREATE TYPE "VaultWriteKind" AS ENUM ('note', 'meeting');

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source" "NoteSource" NOT NULL,
    "body" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "vault_path" TEXT NOT NULL,
    "vault_commit_sha" TEXT,
    "telegram_msg_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vault_writes" (
    "id" TEXT NOT NULL,
    "kind" "VaultWriteKind" NOT NULL,
    "source_id" TEXT NOT NULL,
    "vault_path" TEXT NOT NULL,
    "commit_sha" TEXT,
    "succeeded" BOOLEAN NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_writes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notes_workspace_id_deleted_at_idx" ON "notes"("workspace_id", "deleted_at");

-- CreateIndex
CREATE INDEX "notes_telegram_msg_id_idx" ON "notes"("telegram_msg_id");

-- CreateIndex
CREATE INDEX "vault_writes_kind_source_id_idx" ON "vault_writes"("kind", "source_id");

-- CreateIndex
CREATE INDEX "vault_writes_created_at_idx" ON "vault_writes"("created_at");

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

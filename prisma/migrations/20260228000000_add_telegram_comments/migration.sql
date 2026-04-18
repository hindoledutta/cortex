-- CreateEnum
CREATE TYPE "CommentSource" AS ENUM ('user', 'system', 'llm');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "telegram_msg_id" BIGINT;

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" "CommentSource" NOT NULL DEFAULT 'user',
    "telegram_msg_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comments_task_id_idx" ON "comments"("task_id");

-- CreateIndex
CREATE INDEX "tasks_telegram_msg_id_idx" ON "tasks"("telegram_msg_id");

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


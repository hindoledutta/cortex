-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "reminder_lead_minutes" INTEGER;

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "reminder_lead_minutes" INTEGER NOT NULL DEFAULT 1440,
    "check_in_after_days" INTEGER NOT NULL DEFAULT 3,
    "notification_hour_utc" INTEGER NOT NULL DEFAULT 9,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

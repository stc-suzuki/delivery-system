-- CreateEnum
CREATE TYPE "AssignmentStrategy" AS ENUM ('SWEEP', 'SWEEP_BALANCED');

-- AlterTable
ALTER TABLE "SystemSetting" ADD COLUMN "assignmentStrategy" "AssignmentStrategy" NOT NULL DEFAULT 'SWEEP_BALANCED';

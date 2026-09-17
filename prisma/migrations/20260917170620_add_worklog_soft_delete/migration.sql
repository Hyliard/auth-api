-- AlterTable
ALTER TABLE "WorkLog" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

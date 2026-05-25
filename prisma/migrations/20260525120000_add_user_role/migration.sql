-- AlterTable: add role to User (existing rows default to "reader")
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'reader';

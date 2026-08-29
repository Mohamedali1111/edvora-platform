-- CreateEnum
CREATE TYPE "tenant_student_status" AS ENUM ('ACTIVE', 'INACTIVE', 'REMOVED');

-- CreateTable
CREATE TABLE "tenant_students" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "status" "tenant_student_status" NOT NULL DEFAULT 'ACTIVE',
    "created_by_user_id" UUID,
    "activated_at" TIMESTAMPTZ(6),
    "removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_students_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_students_student_user_id_status_idx" ON "tenant_students"("student_user_id", "status");

-- CreateIndex
CREATE INDEX "tenant_students_tenant_id_status_created_at_idx" ON "tenant_students"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "tenant_students_created_by_user_id_created_at_idx" ON "tenant_students"("created_by_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_students_tenant_id_student_user_id_key" ON "tenant_students"("tenant_id", "student_user_id");

-- AddForeignKey
ALTER TABLE "tenant_students" ADD CONSTRAINT "tenant_students_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_students" ADD CONSTRAINT "tenant_students_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_students" ADD CONSTRAINT "tenant_students_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_tenant_id_student_user_id_fkey" FOREIGN KEY ("tenant_id", "student_user_id") REFERENCES "tenant_students"("tenant_id", "student_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Edvora manually maintained PostgreSQL-specific constraints.
-- Prisma schema cannot express CHECK constraints.
ALTER TABLE "tenant_students"
    ADD CONSTRAINT "tenant_students_activated_at_not_before_created_at_check"
    CHECK ("activated_at" IS NULL OR "activated_at" >= "created_at");

ALTER TABLE "tenant_students"
    ADD CONSTRAINT "tenant_students_removed_at_not_before_created_at_check"
    CHECK ("removed_at" IS NULL OR "removed_at" >= "created_at");

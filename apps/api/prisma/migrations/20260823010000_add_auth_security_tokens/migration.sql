-- CreateEnum
CREATE TYPE "account_activation_purpose" AS ENUM ('INSTRUCTOR_ACTIVATION', 'STUDENT_ACTIVATION');

-- CreateTable
CREATE TABLE "account_activation_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "purpose" "account_activation_purpose" NOT NULL,
    "tenant_id" UUID,
    "initiated_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_activation_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "initiated_by_user_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "consumed_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_activation_tokens_token_hash_key" ON "account_activation_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "account_activation_tokens_outstanding_lookup_idx" ON "account_activation_tokens"("user_id", "consumed_at", "revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "account_activation_tokens_tenant_id_created_at_idx" ON "account_activation_tokens"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "account_activation_tokens_initiated_by_user_id_created_at_idx" ON "account_activation_tokens"("initiated_by_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_outstanding_lookup_idx" ON "password_reset_tokens"("user_id", "consumed_at", "revoked_at", "expires_at");

-- CreateIndex
CREATE INDEX "password_reset_tokens_created_at_idx" ON "password_reset_tokens"("created_at");

-- CreateIndex
CREATE INDEX "password_reset_tokens_initiated_by_user_id_created_at_idx" ON "password_reset_tokens"("initiated_by_user_id", "created_at");

-- AddForeignKey
ALTER TABLE "account_activation_tokens" ADD CONSTRAINT "account_activation_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_activation_tokens" ADD CONSTRAINT "account_activation_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_activation_tokens" ADD CONSTRAINT "account_activation_tokens_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PostgreSQL-specific auth token integrity checks not expressible in Prisma schema.
-- Preserve this section when regenerating migration SQL.
ALTER TABLE "account_activation_tokens"
  ADD CONSTRAINT "account_activation_tokens_expires_after_created_check"
  CHECK ("expires_at" > "created_at");

ALTER TABLE "account_activation_tokens"
  ADD CONSTRAINT "account_activation_tokens_consumed_not_before_created_check"
  CHECK ("consumed_at" IS NULL OR "consumed_at" >= "created_at");

ALTER TABLE "account_activation_tokens"
  ADD CONSTRAINT "account_activation_tokens_revoked_not_before_created_check"
  CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_expires_after_created_check"
  CHECK ("expires_at" > "created_at");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_consumed_not_before_created_check"
  CHECK ("consumed_at" IS NULL OR "consumed_at" >= "created_at");

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_revoked_not_before_created_check"
  CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");

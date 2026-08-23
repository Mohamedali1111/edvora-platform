-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "platform_role" AS ENUM ('STUDENT', 'INSTRUCTOR', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "account_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETION_REQUESTED', 'DELETED');

-- CreateEnum
CREATE TYPE "language_preference" AS ENUM ('EN', 'AR');

-- CreateEnum
CREATE TYPE "credential_type" AS ENUM ('PASSWORD');

-- CreateEnum
CREATE TYPE "refresh_session_status" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "tenant_membership_role" AS ENUM ('OWNER', 'INSTRUCTOR', 'STAFF');

-- CreateEnum
CREATE TYPE "tenant_membership_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

-- CreateEnum
CREATE TYPE "device_platform" AS ENUM ('IOS', 'ANDROID');

-- CreateEnum
CREATE TYPE "student_device_status" AS ENUM ('PENDING', 'APPROVED', 'ACTIVE', 'REVOKED', 'REPLACED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "device_change_request_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "course_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "course_visibility" AS ENUM ('PRIVATE', 'ENROLLED_ONLY');

-- CreateEnum
CREATE TYPE "lesson_type" AS ENUM ('VIDEO', 'DOCUMENT', 'QUIZ');

-- CreateEnum
CREATE TYPE "section_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "lesson_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "asset_processing_status" AS ENUM ('UPLOADING', 'PROCESSING', 'READY', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "video_playback_policy" AS ENUM ('STREAM_ONLY');

-- CreateEnum
CREATE TYPE "document_view_policy" AS ENUM ('IN_APP_ONLY', 'DOWNLOAD_ALLOWED');

-- CreateEnum
CREATE TYPE "quiz_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "question_type" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE');

-- CreateEnum
CREATE TYPE "question_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "quiz_reveal_answers_policy" AS ENUM ('NEVER', 'AFTER_SUBMISSION', 'AFTER_PASSING');

-- CreateEnum
CREATE TYPE "quiz_attempt_status" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'GRADED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "lesson_progress_status" AS ENUM ('NOT_STARTED', 'STARTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "notification_category" AS ENUM ('SYSTEM', 'COURSE', 'SECURITY', 'ADMIN');

-- CreateEnum
CREATE TYPE "security_event_category" AS ENUM ('AUTHENTICATION', 'AUTHORIZATION', 'DEVICE', 'CONTENT', 'ACCOUNT', 'ADMIN');

-- CreateEnum
CREATE TYPE "security_event_severity" AS ENUM ('INFO', 'WARN', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "normalized_email" VARCHAR(320) NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "account_status" "account_status" NOT NULL DEFAULT 'ACTIVE',
    "platform_role" "platform_role" NOT NULL,
    "preferred_language" "language_preference" NOT NULL DEFAULT 'EN',
    "display_name" VARCHAR(160),
    "deletion_requested_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "anonymized_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_credentials" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "credential_type" "credential_type" NOT NULL DEFAULT 'PASSWORD',
    "password_hash" VARCHAR(255) NOT NULL,
    "password_updated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "auth_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_id" UUID,
    "status" "refresh_session_status" NOT NULL DEFAULT 'ACTIVE',
    "refresh_token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instructor_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "instructor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "tenant_membership_role" NOT NULL,
    "status" "tenant_membership_status" NOT NULL DEFAULT 'ACTIVE',
    "removed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_devices" (
    "id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "client_device_id_hash" VARCHAR(255) NOT NULL,
    "platform" "device_platform" NOT NULL,
    "status" "student_device_status" NOT NULL DEFAULT 'PENDING',
    "approved_at" TIMESTAMPTZ(6),
    "activated_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_reason" VARCHAR(500),
    "last_seen_at" TIMESTAMPTZ(6),
    "app_version" VARCHAR(40),
    "os_version" VARCHAR(80),
    "device_model" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "student_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_change_requests" (
    "id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "current_device_id" UUID,
    "requested_device_id" UUID,
    "status" "device_change_request_status" NOT NULL DEFAULT 'PENDING',
    "reason" VARCHAR(500),
    "requested_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "review_note" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "device_change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "thumbnail_asset_ref" VARCHAR(500),
    "status" "course_status" NOT NULL DEFAULT 'DRAFT',
    "visibility" "course_visibility" NOT NULL DEFAULT 'ENROLLED_ONLY',
    "published_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_sections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL,
    "status" "section_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "course_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lessons" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "type" "lesson_type" NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "lesson_status" NOT NULL DEFAULT 'DRAFT',
    "available_from" TIMESTAMPTZ(6),
    "available_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "external_asset_ref" VARCHAR(500) NOT NULL,
    "provider_key" VARCHAR(80),
    "processing_status" "asset_processing_status" NOT NULL DEFAULT 'UPLOADING',
    "duration_seconds" INTEGER,
    "failure_code" VARCHAR(120),
    "failure_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "video_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_lessons" (
    "lesson_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "video_asset_id" UUID NOT NULL,
    "playback_policy" "video_playback_policy" NOT NULL DEFAULT 'STREAM_ONLY',
    "watermark_required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "video_lessons_pkey" PRIMARY KEY ("lesson_id")
);

-- CreateTable
CREATE TABLE "document_assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "external_asset_ref" VARCHAR(500) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "file_size_bytes" BIGINT NOT NULL,
    "processing_status" "asset_processing_status" NOT NULL DEFAULT 'UPLOADING',
    "failure_reason" VARCHAR(1000),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "document_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_lessons" (
    "lesson_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "document_asset_id" UUID NOT NULL,
    "view_policy" "document_view_policy" NOT NULL DEFAULT 'IN_APP_ONLY',
    "watermark_required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "document_lessons_pkey" PRIMARY KEY ("lesson_id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "description" TEXT,
    "status" "quiz_status" NOT NULL DEFAULT 'DRAFT',
    "passing_score_percent" DECIMAL(5,2),
    "attempt_limit" INTEGER,
    "reveal_answers_policy" "quiz_reveal_answers_policy" NOT NULL DEFAULT 'NEVER',
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_lessons" (
    "lesson_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,

    CONSTRAINT "quiz_lessons_pkey" PRIMARY KEY ("lesson_id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "type" "question_type" NOT NULL,
    "prompt" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "points" DECIMAL(10,2) NOT NULL,
    "status" "question_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_options" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "label" VARCHAR(40),
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "is_correct" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "status" "quiz_attempt_status" NOT NULL DEFAULT 'IN_PROGRESS',
    "attempt_number" INTEGER NOT NULL,
    "client_submission_key" VARCHAR(120),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(6),
    "graded_at" TIMESTAMPTZ(6),
    "score_points" DECIMAL(10,2),
    "max_points" DECIMAL(10,2),
    "passed" BOOLEAN,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempt_answers" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "question_id" UUID,
    "question_snapshot" JSONB NOT NULL,
    "options_snapshot" JSONB,
    "selected_option_ids_snapshot" JSONB,
    "selected_value_snapshot" JSONB,
    "correct_answer_snapshot" JSONB NOT NULL,
    "points_awarded" DECIMAL(10,2) NOT NULL,
    "points_possible" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_attempt_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "granted_by_user_id" UUID NOT NULL,
    "status" "enrollment_status" NOT NULL DEFAULT 'ACTIVE',
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "lesson_id" UUID NOT NULL,
    "student_user_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "status" "lesson_progress_status" NOT NULL DEFAULT 'NOT_STARTED',
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "last_accessed_at" TIMESTAMPTZ(6),
    "video_position_seconds" INTEGER,
    "video_watched_seconds" INTEGER,
    "last_client_mutation_id" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "recipient_user_id" UUID NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "category" "notification_category" NOT NULL,
    "title" VARCHAR(240) NOT NULL,
    "body" TEXT NOT NULL,
    "domain_entity_type" VARCHAR(100),
    "domain_entity_id" UUID,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_user_id" UUID,
    "target_user_id" UUID,
    "device_id" UUID,
    "session_id" UUID,
    "event_type" VARCHAR(120) NOT NULL,
    "category" "security_event_category" NOT NULL,
    "severity" "security_event_severity" NOT NULL DEFAULT 'INFO',
    "request_id" VARCHAR(120),
    "ip_hash" VARCHAR(255),
    "user_agent_summary" VARCHAR(500),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");

-- CreateIndex
CREATE INDEX "users_platform_role_account_status_idx" ON "users"("platform_role", "account_status");

-- CreateIndex
CREATE UNIQUE INDEX "auth_credentials_user_id_credential_type_key" ON "auth_credentials"("user_id", "credential_type");

-- CreateIndex
CREATE INDEX "refresh_sessions_user_id_status_idx" ON "refresh_sessions"("user_id", "status");

-- CreateIndex
CREATE INDEX "refresh_sessions_expires_at_idx" ON "refresh_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "student_profiles_user_id_key" ON "student_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "instructor_profiles_user_id_key" ON "instructor_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- CreateIndex
CREATE INDEX "tenant_memberships_user_id_status_idx" ON "tenant_memberships"("user_id", "status");

-- CreateIndex
CREATE INDEX "tenant_memberships_tenant_id_status_idx" ON "tenant_memberships"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_memberships_tenant_id_user_id_key" ON "tenant_memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "student_devices_student_user_id_status_idx" ON "student_devices"("student_user_id", "status");

-- CreateIndex
CREATE INDEX "student_devices_last_seen_at_idx" ON "student_devices"("last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "student_devices_student_user_id_client_device_id_hash_key" ON "student_devices"("student_user_id", "client_device_id_hash");

-- CreateIndex
CREATE INDEX "device_change_requests_status_requested_at_idx" ON "device_change_requests"("status", "requested_at");

-- CreateIndex
CREATE INDEX "device_change_requests_student_user_id_status_idx" ON "device_change_requests"("student_user_id", "status");

-- CreateIndex
CREATE INDEX "courses_tenant_id_status_idx" ON "courses"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "courses_id_tenant_id_key" ON "courses"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_sections_id_tenant_id_key" ON "course_sections"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_sections_id_course_id_tenant_id_key" ON "course_sections"("id", "course_id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_sections_course_id_position_key" ON "course_sections"("course_id", "position");

-- CreateIndex
CREATE INDEX "lessons_course_id_status_idx" ON "lessons"("course_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_id_tenant_id_key" ON "lessons"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_id_tenant_id_course_id_key" ON "lessons"("id", "tenant_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "lessons_section_id_position_key" ON "lessons"("section_id", "position");

-- CreateIndex
CREATE INDEX "video_assets_tenant_id_processing_status_idx" ON "video_assets"("tenant_id", "processing_status");

-- CreateIndex
CREATE UNIQUE INDEX "video_assets_id_tenant_id_key" ON "video_assets"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "video_lessons_video_asset_id_idx" ON "video_lessons"("video_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_lessons_lesson_id_tenant_id_key" ON "video_lessons"("lesson_id", "tenant_id");

-- CreateIndex
CREATE INDEX "document_assets_tenant_id_processing_status_idx" ON "document_assets"("tenant_id", "processing_status");

-- CreateIndex
CREATE UNIQUE INDEX "document_assets_id_tenant_id_key" ON "document_assets"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "document_lessons_document_asset_id_idx" ON "document_lessons"("document_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_lessons_lesson_id_tenant_id_key" ON "document_lessons"("lesson_id", "tenant_id");

-- CreateIndex
CREATE INDEX "quizzes_tenant_id_status_idx" ON "quizzes"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quizzes_id_tenant_id_key" ON "quizzes"("id", "tenant_id");

-- CreateIndex
CREATE INDEX "quiz_lessons_quiz_id_idx" ON "quiz_lessons"("quiz_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_lessons_lesson_id_tenant_id_key" ON "quiz_lessons"("lesson_id", "tenant_id");

-- CreateIndex
CREATE INDEX "questions_quiz_id_status_idx" ON "questions"("quiz_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "questions_id_tenant_id_key" ON "questions"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "questions_quiz_id_position_key" ON "questions"("quiz_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "question_options_question_id_position_key" ON "question_options"("question_id", "position");

-- CreateIndex
CREATE INDEX "quiz_attempts_student_user_id_quiz_id_created_at_idx" ON "quiz_attempts"("student_user_id", "quiz_id", "created_at");

-- CreateIndex
CREATE INDEX "quiz_attempts_enrollment_id_created_at_idx" ON "quiz_attempts"("enrollment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempts_id_tenant_id_key" ON "quiz_attempts"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempts_quiz_id_student_user_id_attempt_number_key" ON "quiz_attempts"("quiz_id", "student_user_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempts_student_user_id_quiz_id_client_submission_key_key" ON "quiz_attempts"("student_user_id", "quiz_id", "client_submission_key");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_attempt_answers_attempt_id_question_id_key" ON "quiz_attempt_answers"("attempt_id", "question_id");

-- CreateIndex
CREATE INDEX "enrollments_student_user_id_status_idx" ON "enrollments"("student_user_id", "status");

-- CreateIndex
CREATE INDEX "enrollments_tenant_id_course_id_status_idx" ON "enrollments"("tenant_id", "course_id", "status");

-- CreateIndex
CREATE INDEX "enrollments_student_user_id_course_id_status_idx" ON "enrollments"("student_user_id", "course_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_id_tenant_id_key" ON "enrollments"("id", "tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_id_tenant_id_student_user_id_key" ON "enrollments"("id", "tenant_id", "student_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_id_tenant_id_student_user_id_course_id_key" ON "enrollments"("id", "tenant_id", "student_user_id", "course_id");

-- CreateIndex
CREATE INDEX "lesson_progress_student_user_id_course_id_idx" ON "lesson_progress"("student_user_id", "course_id");

-- CreateIndex
CREATE INDEX "lesson_progress_enrollment_id_status_idx" ON "lesson_progress"("enrollment_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_progress_student_user_id_lesson_id_enrollment_id_key" ON "lesson_progress"("student_user_id", "lesson_id", "enrollment_id");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_read_at_created_at_idx" ON "notifications"("recipient_user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_created_at_idx" ON "notifications"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_created_at_idx" ON "security_events"("created_at");

-- CreateIndex
CREATE INDEX "security_events_target_user_id_created_at_idx" ON "security_events"("target_user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_actor_user_id_created_at_idx" ON "security_events"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_tenant_id_created_at_idx" ON "security_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_event_type_created_at_idx" ON "security_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "security_events_device_id_created_at_idx" ON "security_events"("device_id", "created_at");

-- AddForeignKey
ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "student_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "instructor_profiles" ADD CONSTRAINT "instructor_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_devices" ADD CONSTRAINT "student_devices_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_change_requests" ADD CONSTRAINT "device_change_requests_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_change_requests" ADD CONSTRAINT "device_change_requests_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_change_requests" ADD CONSTRAINT "device_change_requests_current_device_id_fkey" FOREIGN KEY ("current_device_id") REFERENCES "student_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_change_requests" ADD CONSTRAINT "device_change_requests_requested_device_id_fkey" FOREIGN KEY ("requested_device_id") REFERENCES "student_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_course_id_tenant_id_fkey" FOREIGN KEY ("course_id", "tenant_id") REFERENCES "courses"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_section_id_course_id_tenant_id_fkey" FOREIGN KEY ("section_id", "course_id", "tenant_id") REFERENCES "course_sections"("id", "course_id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_lessons" ADD CONSTRAINT "video_lessons_lesson_id_tenant_id_fkey" FOREIGN KEY ("lesson_id", "tenant_id") REFERENCES "lessons"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_lessons" ADD CONSTRAINT "video_lessons_video_asset_id_tenant_id_fkey" FOREIGN KEY ("video_asset_id", "tenant_id") REFERENCES "video_assets"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_lessons" ADD CONSTRAINT "document_lessons_lesson_id_tenant_id_fkey" FOREIGN KEY ("lesson_id", "tenant_id") REFERENCES "lessons"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_lessons" ADD CONSTRAINT "document_lessons_document_asset_id_tenant_id_fkey" FOREIGN KEY ("document_asset_id", "tenant_id") REFERENCES "document_assets"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_lessons" ADD CONSTRAINT "quiz_lessons_lesson_id_tenant_id_fkey" FOREIGN KEY ("lesson_id", "tenant_id") REFERENCES "lessons"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_lessons" ADD CONSTRAINT "quiz_lessons_quiz_id_tenant_id_fkey" FOREIGN KEY ("quiz_id", "tenant_id") REFERENCES "quizzes"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_quiz_id_tenant_id_fkey" FOREIGN KEY ("quiz_id", "tenant_id") REFERENCES "quizzes"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_question_id_tenant_id_fkey" FOREIGN KEY ("question_id", "tenant_id") REFERENCES "questions"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quiz_id_tenant_id_fkey" FOREIGN KEY ("quiz_id", "tenant_id") REFERENCES "quizzes"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_lesson_id_tenant_id_fkey" FOREIGN KEY ("lesson_id", "tenant_id") REFERENCES "lessons"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_enrollment_id_tenant_id_student_user_id_fkey" FOREIGN KEY ("enrollment_id", "tenant_id", "student_user_id") REFERENCES "enrollments"("id", "tenant_id", "student_user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "quiz_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_tenant_id_fkey" FOREIGN KEY ("course_id", "tenant_id") REFERENCES "courses"("id", "tenant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_tenant_id_course_id_fkey" FOREIGN KEY ("lesson_id", "tenant_id", "course_id") REFERENCES "lessons"("id", "tenant_id", "course_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_enrollment_id_tenant_id_student_user_id_co_fkey" FOREIGN KEY ("enrollment_id", "tenant_id", "student_user_id", "course_id") REFERENCES "enrollments"("id", "tenant_id", "student_user_id", "course_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "student_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "refresh_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- PostgreSQL-only integrity constraints reviewed outside Prisma schema syntax.
-- These constraints intentionally avoid extensions and provider-specific features.

-- Enforce the V1 default of one active student device per student.
CREATE UNIQUE INDEX "student_devices_one_active_per_student_key" ON "student_devices"("student_user_id") WHERE "status" = 'ACTIVE';

-- Prevent competing pending device-change requests for the same student.
CREATE UNIQUE INDEX "device_change_requests_one_pending_per_student_key" ON "device_change_requests"("student_user_id") WHERE "status" = 'PENDING';

-- Prevent duplicate simultaneously active course access while preserving revoked/expired/inactive history rows.
CREATE UNIQUE INDEX "enrollments_one_active_per_student_course_key" ON "enrollments"("student_user_id", "course_id") WHERE "status" = 'ACTIVE';

-- Stable mathematical/domain checks.
ALTER TABLE "course_sections" ADD CONSTRAINT "course_sections_position_non_negative_chk" CHECK ("position" >= 0);
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_position_non_negative_chk" CHECK ("position" >= 0);
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_available_range_chk" CHECK ("available_from" IS NULL OR "available_until" IS NULL OR "available_from" <= "available_until");
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_duration_non_negative_chk" CHECK ("duration_seconds" IS NULL OR "duration_seconds" >= 0);
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_file_size_non_negative_chk" CHECK ("file_size_bytes" >= 0);
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_passing_score_percent_range_chk" CHECK ("passing_score_percent" IS NULL OR ("passing_score_percent" >= 0 AND "passing_score_percent" <= 100));
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_attempt_limit_positive_chk" CHECK ("attempt_limit" IS NULL OR "attempt_limit" > 0);
ALTER TABLE "questions" ADD CONSTRAINT "questions_position_non_negative_chk" CHECK ("position" >= 0);
ALTER TABLE "questions" ADD CONSTRAINT "questions_points_non_negative_chk" CHECK ("points" >= 0);
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_position_non_negative_chk" CHECK ("position" >= 0);
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_attempt_number_positive_chk" CHECK ("attempt_number" > 0);
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_score_points_non_negative_chk" CHECK ("score_points" IS NULL OR "score_points" >= 0);
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_max_points_non_negative_chk" CHECK ("max_points" IS NULL OR "max_points" >= 0);
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_score_not_above_max_chk" CHECK ("score_points" IS NULL OR "max_points" IS NULL OR "score_points" <= "max_points");
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_submitted_after_started_chk" CHECK ("submitted_at" IS NULL OR "submitted_at" >= "started_at");
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_graded_after_started_chk" CHECK ("graded_at" IS NULL OR "graded_at" >= "started_at");
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_points_awarded_non_negative_chk" CHECK ("points_awarded" >= 0);
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_points_possible_non_negative_chk" CHECK ("points_possible" >= 0);
ALTER TABLE "quiz_attempt_answers" ADD CONSTRAINT "quiz_attempt_answers_points_awarded_not_above_possible_chk" CHECK ("points_awarded" <= "points_possible");
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_date_range_chk" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "starts_at" <= "ends_at");
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_video_position_non_negative_chk" CHECK ("video_position_seconds" IS NULL OR "video_position_seconds" >= 0);
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_video_watched_non_negative_chk" CHECK ("video_watched_seconds" IS NULL OR "video_watched_seconds" >= 0);
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_completed_after_started_chk" CHECK ("started_at" IS NULL OR "completed_at" IS NULL OR "completed_at" >= "started_at");

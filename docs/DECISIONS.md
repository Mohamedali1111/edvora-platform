# Decision Log

This log records durable product and architecture decisions. Dates use ISO format.

## DEC-0001: Single Monorepo

- Date: 2026-08-23
- Status: Accepted
- Decision: Edvora uses a single monorepo.
- Reasoning: Mobile, web, API, and future shared code need coordinated evolution without creating operational overhead across separate repositories.
- Implications: Root tooling must stay lean and workspace-aware. Shared packages should be added only when real shared code exists.

## DEC-0002: Student V1 Surface Is Mobile

- Date: 2026-08-23
- Status: Accepted
- Decision: Student V1 is delivered through a native iOS and Android mobile app.
- Reasoning: The student experience and planned native security capabilities require mobile-first implementation.
- Implications: The mobile architecture must not depend on Expo Go and must support development/custom builds when native capabilities are needed.

## DEC-0003: Instructor and Platform Admin Management Is Web

- Date: 2026-08-23
- Status: Accepted
- Decision: Instructor and Platform Admin workflows are delivered through a responsive web dashboard.
- Reasoning: Management workflows are better suited to responsive web interfaces with tables, forms, and operational views.
- Implications: Web implementation must support responsive behavior across desktop, laptop, tablet, and reasonable smaller widths.

## DEC-0004: Instructor and Platform Admin Share One Web App

- Date: 2026-08-23
- Status: Accepted
- Decision: Instructor and Platform Admin dashboards live in one web application.
- Reasoning: Shared management UI infrastructure and routing can serve both roles while enforcing role-based authorization.
- Implications: Admin capabilities must use explicit Platform Admin authorization paths and must not be exposed through tenant instructor permissions.

## DEC-0005: Shared Backend API

- Date: 2026-08-23
- Status: Accepted
- Decision: All product surfaces use one shared backend API.
- Reasoning: Centralizing business rules keeps authentication, authorization, tenancy, device authorization, and entitlement checks consistent.
- Implications: Clients must not duplicate security logic as the source of truth.

## DEC-0006: Planned Backend Stack Is NestJS

- Date: 2026-08-23
- Status: Accepted
- Decision: The backend API will use NestJS with TypeScript.
- Reasoning: NestJS provides a structured modular backend model suitable for a growing TypeScript SaaS application.
- Implications: Backend modules should remain focused and aligned to product domains.

## DEC-0007: Planned Web Stack Is Next.js

- Date: 2026-08-23
- Status: Accepted
- Decision: The web dashboard will use Next.js with TypeScript.
- Reasoning: Next.js is suitable for responsive web dashboards and modern TypeScript application development.
- Implications: Routing and authorization must support both Instructor and Platform Admin surfaces in one app.

## DEC-0008: Planned Mobile Stack Is React Native + Expo

- Date: 2026-08-23
- Status: Accepted
- Decision: The student mobile app will use React Native + Expo + TypeScript with development/custom build readiness.
- Reasoning: Expo accelerates React Native delivery while custom builds preserve access to native capabilities needed for security features.
- Implications: Architecture must not depend on Expo Go.

## DEC-0009: PostgreSQL and Prisma

- Date: 2026-08-23
- Status: Accepted
- Decision: PostgreSQL is the planned database and Prisma is the planned ORM.
- Reasoning: PostgreSQL is a durable relational foundation for SaaS tenancy, authorization, courses, quizzes, progress, and audit data.
- Implications: Schema design, indexes, and migrations should be reviewed carefully when database work begins.

## DEC-0010: Multi-Tenant From the Beginning

- Date: 2026-08-23
- Status: Accepted
- Decision: Edvora is designed as SaaS from the beginning.
- Reasoning: Tenant boundaries are core to instructor-owned/academy-owned resources and cannot be safely bolted on later.
- Implications: Tenant-scoped resources and queries must enforce server-side tenant isolation.

## DEC-0011: One Approved Student Device by Default

- Date: 2026-08-23
- Status: Accepted
- Decision: V1 defaults to one approved active device per student.
- Reasoning: Device control is a core security requirement for protected educational content.
- Implications: The limit must be configurable in architecture and enforced server-side.

## DEC-0012: Device Changes Controlled by Platform Admin

- Date: 2026-08-23
- Status: Accepted
- Decision: Platform Admin approves or rejects student device-change requests in V1.
- Reasoning: Device reset approval is security-sensitive platform operation.
- Implications: Instructors must not approve or reset student devices in V1.

## DEC-0013: Arabic and English From Day One

- Date: 2026-08-23
- Status: Accepted
- Decision: Arabic and English support is mandatory from the beginning.
- Reasoning: Bilingual support affects layout, content modeling, QA, navigation, and accessibility.
- Implications: UI implementation must support RTL/LTR without duplicated screen implementations.

## DEC-0014: No In-App Payments in V1

- Date: 2026-08-23
- Status: Accepted
- Decision: V1 has no student in-app purchases, course checkout, or subscription purchase flow.
- Reasoning: Instructor subscriptions are handled externally and manually in V1.
- Implications: Future billing should be designed later without rewriting tenancy or entitlement models.

## DEC-0015: Security-First Architecture

- Date: 2026-08-23
- Status: Accepted
- Decision: Security is a core architecture concern and must be server-enforced.
- Reasoning: Client-only hiding or UI restrictions do not protect content or accounts.
- Implications: Authentication, authorization, device authorization, entitlements, and playback authorization belong on the backend.

## DEC-0016: Do Not Self-Build Fake DRM

- Date: 2026-08-23
- Status: Accepted
- Decision: Edvora will not self-build fake DRM.
- Reasoning: Video protection requires specialized evaluation and potentially specialized providers.
- Implications: The architecture should be DRM-ready while provider selection remains deferred.

## DEC-0017: Low-Cost Infrastructure Initially

- Date: 2026-08-23
- Status: Accepted
- Decision: Initial infrastructure should stay low-cost and simple.
- Reasoning: Early-stage reliability benefits from fewer moving parts.
- Implications: Add Redis, queues, caches, analytics, or similar infrastructure only after demonstrated need.

## DEC-0018: Video Provider Decision Postponed

- Date: 2026-08-23
- Status: Accepted
- Decision: Video/security infrastructure selection is postponed until a dedicated technical and cost evaluation.
- Reasoning: Provider choice has cost, security, DRM, platform, and operational implications.
- Implications: No video provider is integrated or chosen in the repository foundation task.

## DEC-0019: Application Framework Version Baselines

- Date: 2026-08-23
- Status: Accepted
- Decision: The initial app scaffolds use NestJS 11.2.1 for API, Next.js 16.3.2 for web, and Expo SDK 57.0.15 with Expo Router 57.0.15 for mobile.
- Reasoning: These are current stable framework lines compatible with the Node.js 22 baseline and the planned architecture.
- Implications: Future upgrades should be deliberate and validated across all affected app surfaces.

## DEC-0020: Expo Router for Student Mobile Scaffold

- Date: 2026-08-23
- Status: Accepted
- Decision: The student mobile scaffold uses Expo Router with file-based routing.
- Reasoning: Expo Router is the current official routing convention for Expo applications and remains compatible with future development/custom builds.
- Implications: The current route tree stays minimal. Product navigation, tabs, auth flows, and protected routes are deferred until real product implementation.

## DEC-0021: Tenant Membership Strategy

- Date: 2026-08-23
- Status: Accepted
- Decision: Users relate to instructor-owned teaching workspaces through `TenantMembership` rather than a single `tenantId` on `User`.
- Reasoning: A tenant represents an instructor/academy workspace, instructors may later add staff, and a student may study with more than one tenant over time.
- Implications: Server-side authorization must resolve tenant access from membership, enrollment, and resource ownership. Platform Admin remains platform-wide rather than an ordinary tenant member.

## DEC-0022: Canonical User Identity Model

- Date: 2026-08-23
- Status: Accepted
- Decision: Edvora uses one canonical `User` identity model with role/capability, profile, tenant membership, and enrollment modeled separately.
- Reasoning: Separate identities for Student, Instructor, and Platform Admin would duplicate authentication and make cross-role/account lifecycle behavior harder to secure.
- Implications: Authentication credentials belong to the server-side auth layer. Student/instructor profile data and tenant/course access must not be treated as separate login identities.

## DEC-0023: UUIDv7-Compatible Primary IDs

- Date: 2026-08-23
- Status: Accepted
- Decision: Database primary IDs should use UUIDv7-compatible values stored as PostgreSQL `uuid` where practical.
- Reasoning: UUIDv7 provides public-ID safety and distributed generation while improving index locality compared with random UUIDv4.
- Implications: Prisma implementation may generate IDs in application code or use a reviewed database function/extension later. Sequential public IDs should not be used.

## DEC-0024: Lesson-Centered Content Hierarchy

- Date: 2026-08-23
- Status: Accepted
- Decision: Course sections contain ordered generic `Lesson` records with type-specific one-to-one detail records for video, document, and quiz content.
- Reasoning: This keeps ordering, publication state, and lifecycle fields consistent while preserving normalized type-specific metadata.
- Implications: Future content types can be added with new detail tables without redesigning section ordering.

## DEC-0025: Quiz Attempt Snapshot Strategy

- Date: 2026-08-23
- Status: Accepted
- Decision: Quiz attempts must retain bounded snapshots of question, option, selected-answer, correct-answer, and scoring data needed to interpret past attempts.
- Reasoning: Instructors may edit quizzes after students complete them, and historical attempts must remain interpretable without building a large assessment versioning engine in V1.
- Implications: Correct-answer snapshots are backend-only and must not be exposed before the reveal policy allows it.

## DEC-0026: Deletion and Anonymization Principle

- Date: 2026-08-23
- Status: Accepted
- Decision: Account deletion should support status transitions plus deletion/anonymization fields rather than blind cascade deletion of all records.
- Reasoning: Edvora must balance privacy/account deletion requirements with security audit integrity, instructor operational records, quiz history, and legal/abuse-prevention retention.
- Implications: Final retention policy remains pending, but schema design must support deleting/anonymizing direct PII while retaining minimal justified historical records.

## DEC-0027: Prisma Model Naming and PostgreSQL Mapping

- Date: 2026-08-23
- Status: Accepted
- Decision: Prisma models and fields use idiomatic PascalCase/camelCase names while mapping PostgreSQL tables and columns to snake_case with `@@map` and `@map`.
- Reasoning: This keeps TypeScript application code ergonomic while preserving a conventional PostgreSQL schema naming style.
- Implications: Future Prisma models should apply the mapping convention consistently and avoid mixing unmapped table/column naming styles.

## DEC-0028: Reviewed SQL Migration Artifacts

- Date: 2026-08-23
- Status: Accepted
- Decision: Initial PostgreSQL migrations are generated as reviewable SQL artifacts before being applied to any database.
- Reasoning: Edvora needs explicit review of table structure, referential actions, indexes, partial indexes, check constraints, and PostgreSQL-only SQL before any environment is modified.
- Implications: Migration SQL may include reviewed PostgreSQL constraints not expressible in Prisma schema. Applied migrations in shared environments must not be edited; follow-up changes require new migrations.

## DEC-0029: Application-Generated UUIDv7 Until PostgreSQL Version Is Selected

- Date: 2026-08-23
- Status: Accepted
- Decision: The initial PostgreSQL schema stores primary IDs as `uuid` without database defaults; UUIDv7 values will be generated by the application layer when write paths are implemented.
- Reasoning: PostgreSQL 18 provides native `uuidv7()`, but Edvora has not selected a hosting provider or minimum PostgreSQL major version. Avoiding database UUID defaults keeps the initial migration portable.
- Implications: Future database/runtime work must implement UUIDv7 generation deliberately and must not silently replace it with sequential IDs or fake UUIDv7.

## DEC-0030: Prisma 7 PostgreSQL Runtime Adapter

- Date: 2026-08-23
- Status: Accepted
- Decision: The NestJS API uses Prisma 7 with `@prisma/adapter-pg` and `pg` for PostgreSQL runtime connectivity.
- Reasoning: Prisma 7 requires driver adapters for database connectivity, and the official PostgreSQL adapter keeps the runtime path aligned with current Prisma behavior.
- Implications: The API owns one `pg` pool per process through the Nest database boundary. Future runtime DB changes must evaluate Prisma 7 adapter requirements explicitly rather than copying older Prisma patterns.

## DEC-0031: Explicit Database Module and Migration Separation

- Date: 2026-08-23
- Status: Accepted
- Decision: Database access is provided through an explicit NestJS `DatabaseModule`, and migrations are not run automatically during API startup.
- Reasoning: Explicit imports keep module dependencies visible, and separating schema deployment from application boot keeps releases reviewable and safer.
- Implications: Feature modules that need database access must import the database module deliberately. Migration execution remains a deployment/release responsibility.

## DEC-0032: Argon2id for Password Hashing

- Date: 2026-08-23
- Status: Accepted
- Decision: Edvora V1 password authentication will use Argon2id for new password hashes.
- Reasoning: Argon2id is a modern memory-hard password hashing algorithm recommended for new systems when the Node deployment environment supports it reliably.
- Implications: Implementation must benchmark parameters before production, store only encoded hashes, support future parameter upgrades, and never store or log plaintext passwords.

## DEC-0033: Short-Lived JWT Access Tokens and Opaque Refresh Tokens

- Date: 2026-08-23
- Status: Accepted
- Decision: Edvora will use 10-minute HS256 signed JWT access tokens and long-lived opaque rotating refresh tokens stored only as server-side SHA-256 or equivalent cryptographic digests.
- Reasoning: JWT access tokens are practical for API identity propagation when kept minimal and short-lived, while opaque refresh tokens provide clean server-side revocation and replay detection.
- Implications: JWTs must not contain tenant memberships, course access, device secrets, or sensitive PII. The HS256 secret must have at least 256 bits of entropy and must never be committed. Refresh rotation must be transactional and replay-aware.

## DEC-0034: Web Refresh Sessions Prefer HttpOnly Secure Cookies

- Date: 2026-08-23
- Status: Accepted
- Decision: Instructor/Admin web refresh session material should use HttpOnly Secure cookies where deployment topology allows it.
- Reasoning: Long-lived refresh tokens should not be exposed to browser JavaScript when a cookie-based approach is practical.
- Implications: Web auth implementation must include SameSite/CSRF/origin protections and must still treat XSS as a serious threat.

## DEC-0035: Managed V1 Account Creation and Activation

- Date: 2026-08-23
- Status: Accepted
- Decision: V1 has no public Instructor or Student self-registration. Platform Admin initiates Instructor activation, and Instructor or Platform Admin workflows invite/create students through tenant/course operations.
- Reasoning: Edvora V1 is an instructor SaaS with external instructor billing and controlled student access, not a public marketplace or self-serve student platform.
- Implications: Admins and instructors must never set permanent user passwords. New users set their own passwords through purpose-bound single-use activation tokens.

## DEC-0036: Purpose-Specific One-Time Auth Tokens

- Date: 2026-08-23
- Status: Accepted
- Decision: Account activation and password reset require explicit purpose-specific token entities rather than overloading `RefreshSession`.
- Reasoning: Activation, reset, and refresh sessions have different purposes, actors, expiry, consumption, revocation, and audit semantics.
- Implications: Add planned `AccountActivationToken` and `PasswordResetToken` persistence before implementing activation/reset flows.

## DEC-0037: Auth One-Time Token Hash Storage

- Date: 2026-08-23
- Status: Accepted
- Decision: Account activation and password reset token tables store only lowercase hexadecimal SHA-256 token digests in `CHAR(64)` columns with unique token-hash indexes.
- Reasoning: Activation/reset tokens are machine-generated high-entropy values, so a fast cryptographic digest is appropriate for lookup while avoiding raw-token persistence. Hex text keeps Prisma/PostgreSQL handling simple and portable.
- Implications: Future application code must generate at least 256 bits of token entropy, persist only the canonical digest, avoid logging raw tokens or hashes, and perform issuance/consumption in transactions.

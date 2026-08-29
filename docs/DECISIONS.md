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

## DEC-0038: Internal Auth Primitive Runtime Choices

- Date: 2026-08-23
- Status: Accepted
- Decision: Internal auth primitives use `argon2@0.45.1` for Argon2id password hashing, `@nestjs/jwt@11.0.2` for HS256 access-token signing/verification, Node `crypto` for opaque tokens and SHA-256 token digests, and a local RFC 9562 UUIDv7 generator for application-generated IDs.
- Reasoning: These choices match the approved auth design while keeping dependencies minimal and compatible with the current CommonJS NestJS build. The current stable `uuid` package is ESM-only, so a small tested local UUIDv7 generator avoids changing the API module system for this milestone.
- Implications: Refresh rotation requires the refresh session ID plus the opaque refresh token. Rotation uses transactional conditional updates so only one presented token can rotate successfully; near-simultaneous duplicate use is rejected without minting another chain, and stale replay outside the retry grace window revokes the session.

## DEC-0039: Internal Auth Orchestration Before Public Transport

- Date: 2026-08-23
- Status: Accepted
- Decision: Login, account activation, refresh, logout, logout-all, password change, and password-reset completion are implemented first as internal NestJS orchestration services, with public HTTP controllers, guards, cookies, CSRF handling, and client storage deferred.
- Reasoning: Keeping orchestration separate from transport lets Edvora validate transaction boundaries, token/session handling, and security-event persistence before exposing API routes.
- Implications: Public controllers call the internal orchestration services rather than duplicating credential, token, or session logic. Web refresh sessions use the concrete V1 default of 10 hours, while mobile refresh sessions use 30 days.

## DEC-0040: Public Auth HTTP Transport

- Date: 2026-08-28
- Status: Accepted
- Decision: Public auth routes are exposed under `/auth/*`; access tokens use Bearer transport, web refresh material uses HttpOnly cookies, and mobile refresh material uses explicit request/response body transport.
- Reasoning: This keeps long-lived web refresh tokens away from browser JavaScript while preserving mobile secure-storage compatibility and a simple shared API boundary.
- Implications: Web refresh does not accept body refresh-token fallback. Future frontend/mobile clients must preserve the transport distinction.

## DEC-0041: Web Auth Cookie and Origin Policy

- Date: 2026-08-28
- Status: Accepted
- Decision: Web auth cookies use path `/auth`, SameSite `Lax` by default, production `Secure`, and trusted `Origin` validation for web-channel or web-cookie auth requests.
- Reasoning: Same-site dashboard/API deployment is the preferred V1 assumption; wildcard credentialed CORS and casual SameSite `None` would increase CSRF risk.
- Implications: Cross-site web/API deployment requires revisiting cookie, CORS, and CSRF configuration before release.

## DEC-0042: Initial In-Process Auth Rate Limiting

- Date: 2026-08-28
- Status: Accepted
- Decision: Auth routes use Nest-compatible in-process throttling as the initial V1 public abuse-control boundary.
- Reasoning: It adds immediate protection for a single API process without introducing Redis or new infrastructure before demonstrated need.
- Implications: Rate limiting is not horizontally consistent. Before multi-replica production scaling or serious abuse exposure, Edvora must adopt a shared/distributed rate-limit strategy and explicit proxy trust configuration.

## DEC-0043: Installation-Scoped Student Device Authorization

- Date: 2026-08-28
- Status: Accepted
- Decision: Student device authorization uses a native-app-generated installation-scoped UUID sent through `X-Edvora-Installation-Id`; the backend stores only a SHA-256 hash and checks current PostgreSQL device state for guarded student routes.
- Reasoning: This enforces the V1 one-active-device policy without invasive hardware fingerprinting or trusting JWT/device claims.
- Implications: Login alone does not authorize protected student content. A different installation must use the device-change workflow, and future protected student resources must compose Bearer authentication with the device guard.

## DEC-0044: Platform Admin Owns Device Change Review

- Date: 2026-08-28
- Status: Accepted
- Decision: Device-change approval/rejection is a Platform Admin operation in V1; instructors cannot approve, reject, reset, or replace student devices.
- Reasoning: Device replacement affects content security and support/audit posture at the platform level.
- Implications: Admin review paths must verify current database role/status before mutation. Instructor support workflows may request help later but must not control device replacement.

## DEC-0045: TenantStudent Separates Learner Association From Staff Membership

- Date: 2026-08-29
- Status: Accepted
- Decision: Students must not be represented as `TenantMembershipRole.STUDENT`. `TenantMembership` remains staff/operator-only, and tenant-associated learners require a separate `TenantStudent` model with one durable row per `(tenantId, studentUserId)`.
- Reasoning: Students are learners, not tenant operators. A separate association lets instructors list/invite students before course enrollment while preserving global student identity reuse and keeping `Enrollment` focused on course entitlement.
- Implications: `TenantStudent` persistence is implemented through a reviewed additive migration with a composite enrollment integrity relationship from `Enrollment(tenantId, studentUserId)` to `TenantStudent(tenantId, studentUserId)`. Tenancy/enrollment service implementation must use this association rather than adding students to `TenantMembership`.

## DEC-0046: Tenant And Enrollment Authorization Foundation

- Date: 2026-08-29
- Status: Accepted
- Decision: Platform Admin instructor onboarding, instructor tenant/student/enrollment APIs, and student enrollment reads use database-fresh authorization checks rather than trusting JWT tenant or role claims alone.
- Reasoning: Tenant boundaries and enrollment grants are security-sensitive SaaS controls. Platform Admin operations must verify current platform role/status; instructor operations must verify current instructor role/status and active tenant membership; student enrollment reads must compose authenticated identity with approved student-device authorization.
- Implications: `TenantStudent` remains the learner association, `Enrollment` remains course entitlement, activation-token delivery is still deferred, and course/content authorization must build on this boundary rather than embedding tenant, course, enrollment, or device state into JWTs.

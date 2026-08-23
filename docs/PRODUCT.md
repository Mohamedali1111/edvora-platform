# Product

## Purpose

Edvora is a security-first bilingual EdTech SaaS platform for instructors and their students. It helps instructors deliver controlled course access, protected learning content, quizzes, and student progress tracking while giving Edvora platform operators the administrative controls required for a commercial SaaS product.

## Target Users

- Students who consume assigned course content from native iOS and Android applications.
- Instructors who manage their courses, students, enrollments, and learning operations from a responsive web dashboard.
- Platform Admins who operate the Edvora platform, manage tenants, handle security-sensitive requests, and support instructors.

## Roles

V1 has exactly three primary roles:

- `STUDENT`
- `INSTRUCTOR`
- `PLATFORM_ADMIN`

## Business Model

Instructors are Edvora's paying customers. Instructor subscriptions are handled externally and manually outside the student mobile application in V1.

V1 has no in-app payment, course purchase, checkout, subscription purchase, Stripe, Paymob, or equivalent payment flow. The platform should still be designed so commercial billing can be added later without rewriting core tenancy, entitlement, or access-control models.

## Main Product Surfaces

- Student: native React Native + Expo mobile application for iOS and Android, using development/custom builds when native security capabilities are required. The architecture must not depend on Expo Go.
- Instructor: responsive web dashboard.
- Platform Admin: responsive web dashboard.
- Backend: one shared API serving all product surfaces.

Instructor and Platform Admin dashboards live in the same web application and use role-based routing and authorization.

## V1 Scope

Core V1 domains are:

- Authentication
- Users
- Instructors
- Students
- Multi-tenancy
- Device management
- Device change requests
- Courses
- Course sections
- Lessons/content
- Secure videos
- PDFs/documents
- Quizzes
- Questions
- Quiz attempts/results
- Student enrollments/access
- Learning progress
- Basic notifications
- Security events
- Platform administration

Expected course hierarchy:

```text
Course
-> Sections
-> Ordered content/lessons
```

A lesson/content item may represent a video, PDF/document, or quiz.

## Explicit Non-Goals

The following are intentional non-goals for V1 unless later requested and approved:

- Live classes
- AI features
- Chat/community
- Parent accounts
- Accounting
- Full CRM
- Certificates
- Marketplace
- Public course store
- In-app purchases
- Course checkout
- Instructor billing portal
- White-label apps
- Assignments/homework engine
- Advanced gamification
- Complex attendance
- WhatsApp/SMS automation
- Advanced enterprise organization structures

These are not missing work. They are deliberately excluded to keep V1 focused.

## High-Level User Journeys

- A Platform Admin creates or manages instructor/tenant access.
- An instructor manages course structure, lessons, quizzes, student enrollments, and progress visibility within their tenant boundary.
- A student signs in, uses an approved device, views assigned courses, consumes protected content, completes quizzes, and tracks progress.
- A student who needs to use a different device submits a device-change request.
- A Platform Admin reviews and approves or rejects device-change requests. Instructors do not approve or reset student devices in V1.
- The backend verifies authentication, authorization, tenant access, course entitlement, device authorization, and content playback authorization before allowing protected actions.

## Product Principles

- Security is a core product differentiator, not a cosmetic UI feature.
- Keep V1 deliberately focused and avoid generic LMS sprawl.
- Arabic and English receive equal product, design, and QA attention.
- Build as SaaS from the beginning, with clear tenant boundaries.
- Prefer scale-ready architecture over scale-expensive infrastructure.
- Avoid premature vendor commitments, especially for video/security infrastructure, until explicit technical and cost evaluation is completed.

# In-App Notifications

## Scope

Edvora V1 notifications are in-app records only. The backend persists notification rows and exposes
self-inbox read APIs for authenticated students and instructors.

Deferred delivery channels and systems:

- Email
- SMS
- Mobile push
- Expo Notifications
- APNs / Firebase push
- Queues, workers, schedules, campaigns, templates, quiet hours, and bulk announcements
- Realtime WebSockets or SSE

## Model

The V1 schema has one `Notification` model:

- `id`
- `tenantId` nullable for platform-level notifications
- `recipientUserId`
- `type`
- `category`
- `title`
- `body`
- `domainEntityType` nullable
- `domainEntityId` nullable
- `readAt` nullable
- `createdAt`

There is no separate recipient table in V1. Read/unread state belongs to the recipient's
notification row through `readAt`.

## Ownership

Inbox reads and read mutations derive the recipient from the authenticated principal. Clients never
send authoritative `userId`, `recipientId`, or `tenantId` to list or mark their own notifications.

Student routes use both `AccessTokenGuard` and `StudentDeviceGuard`, matching protected student app
surfaces. Instructor routes use the existing authenticated instructor principal checks.

Foreign and random notification IDs collapse to the same `NOTIFICATION_NOT_FOUND` response. The API
does not reveal whether another recipient, tenant relationship, or notification exists.

## API

Student self-inbox:

- `GET /student/notifications`
- `GET /student/notifications/unread-count`
- `PATCH /student/notifications/:notificationId/read`
- `PATCH /student/notifications/read-all`

Instructor self-inbox:

- `GET /instructor/notifications`
- `GET /instructor/notifications/unread-count`
- `PATCH /instructor/notifications/:notificationId/read`

List responses are bounded with the existing `limit` / `offset` pagination convention. The default
limit is `25`, the maximum limit is `100`, and ordering is deterministic:

```text
createdAt DESC, id DESC
```

Responses expose a recipient-safe DTO only: notification ID, type, category, title, body, optional
domain reference, read/readAt, and createdAt. They do not expose another recipient's ID, tenant
internals, provider metadata, delivery state, or security-sensitive payloads.

Mark-read is idempotent. If a notification is already read, the existing `readAt` is preserved.
Read-all uses one scoped database update for the current recipient's unread rows and does not
rewrite already-read timestamps.

Unread count is computed with a scoped database `count`, not by loading rows into memory.

## Creation

Application code should create notifications through `NotificationService`, not through a public
"send arbitrary notification" endpoint.

Tenant-scoped creation validates the recipient's tenant relationship:

- Student recipients must be active students associated to the tenant through active
  `TenantStudent`.
- Instructor recipients must be active instructors with active tenant membership in an active
  tenant.

## Enrollment Producer

The first V1 producer is narrow: when an instructor successfully creates a new active enrollment,
the enrolled student receives one `COURSE_ENROLLMENT_CREATED` in-app notification.

The enrollment row, security event, and notification are created in the same database transaction.
The producer uses a transaction-scoped PostgreSQL advisory lock on the domain notification key and
checks the existing domain reference before insert. This keeps retries and concurrent producer calls
from creating duplicate notifications without adding a migration.

Rejected enrollment attempts, including cross-tenant attempts, create no notification.

# Reliability

## Planning Assumptions

These are planning assumptions, not performance guarantees.

- Initial stage: about 10 instructors and 1,000 students.
- Early growth: about 100 instructors and 10,000 students.
- Growth design target: about 1,000 instructors and 100,000+ registered students.

Registered users are not the same as concurrent users. Capacity planning must use actual traffic, concurrency, content consumption, quiz activity, and media usage patterns once measured.

## Cost-Conscious Scaling Philosophy

Edvora should pursue scale-ready architecture, not scale-expensive infrastructure. Start with simple, reliable components and add infrastructure only when a real product, reliability, security, or performance need is demonstrated.

Do not introduce Redis, queues, dedicated caches, third-party analytics, or other infrastructure by default.

## API Reliability Principles

The backend should support:

- Stateless API design where practical.
- Horizontal API scaling.
- Health checks.
- Request/correlation IDs.
- Structured logging.
- Rate limiting where abuse or cost exposure exists.
- Idempotency for retryable operations where relevant.
- Mobile API backward compatibility awareness because users may run older app versions.
- Graceful handling of third-party service failures.

Non-critical analytics or notification failures must not take down critical authentication or content-access flows.

## Database Principles

PostgreSQL is the planned database and Prisma is the planned ORM.

Future database implementation should include:

- Proper indexes based on query patterns.
- Pagination for list endpoints.
- Efficient query patterns.
- Prevention of N+1 query problems.
- Connection pooling.
- Tenant-scoped query discipline.
- Safe migrations.
- Backup and restore procedures.

## Media and Video Delivery

Large media uploads should use direct/object-storage-based patterns rather than routing huge files through ordinary API memory.

Video delivery should use specialized storage/CDN/video infrastructure rather than NestJS streaming every video byte. Provider selection is intentionally deferred until a dedicated technical and cost evaluation.

## Failure Isolation

Critical authentication, authorization, entitlement, device authorization, and protected content-access flows should be isolated from non-critical failures where practical.

Third-party service outages should degrade affected non-critical features gracefully rather than causing platform-wide failure.

## Observability

Future implementation should include structured logs, request/correlation IDs, health checks, error tracking/monitoring, and security event records.

Observability must not leak secrets, tokens, passwords, or sensitive authentication material.

## Backup and Restore

Backups are only useful if restore procedures are understood and periodically verified. Future production readiness must include database backup schedules, retention decisions, restore documentation, and restore testing appropriate to the stage of the product.

## Deployment and Migration Safety

Future deployment practices should include safe database migrations, rollback awareness, backward-compatible API changes for mobile clients, and release checks that protect authentication and content access.

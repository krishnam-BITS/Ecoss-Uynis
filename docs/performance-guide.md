# Performance Guide

This guide focuses on practical performance validation and improvements for UI/API/Git edge flows.

## Baseline Checks
- API health latency:
```bash
curl -w "\nconnect=%{time_connect}s total=%{time_total}s\n" -o NUL -s http://localhost:4000/health
```
- Git edge health latency:
```bash
curl -w "\nconnect=%{time_connect}s total=%{time_total}s\n" -o NUL -s http://localhost:4001/health
```

## UI Responsiveness Checklist
- Keep route payloads paginated.
- Keep first screen render dependencies minimal.
- Show skeleton states immediately for async pages.
- Avoid blocking UI while long tasks run.

## API Throughput Checklist
- Use proper indexes for `workspaceId`, `repoId`, `createdAt`-filtered lists.
- Use cursor pagination for high-volume endpoints.
- Avoid N+1 queries in list endpoints.
- Move long-running import/index tasks to worker queue.

## Caching Strategy
- Redis: short-lived computed data and rate-limiting keys.
- OpenSearch: full-text search and filtered query acceleration.
- Browser cache: static assets from web build.

## Git Edge Performance
- Keep repo storage on fast local volume.
- Periodically run git maintenance tasks for large repositories.
- Keep auth checks lightweight and avoid expensive DB calls per request where possible.

## Fast-path Improvements to Consider
1. Add response compression for large JSON payloads.
2. Add ETag/conditional requests for stable read endpoints.
3. Pre-compute dashboard aggregates in background jobs.
4. Add connection pooling and tuned limits for Postgres and Redis.

## Frontend Speed Improvements to Consider
1. Prefetch likely next routes.
2. Defer non-critical components.
3. Limit oversized CSS and dead style blocks.
4. Keep expensive tables virtualized when row counts are high.

## Validation Before Release
- Run load checks for top read endpoints.
- Capture p50/p95 latency for: dashboard, repo page, issue list, pull list.
- Verify no broken links in README/docs and major UI navigation paths.

---
Written by Krishnam Murarka (km@edilec.com)


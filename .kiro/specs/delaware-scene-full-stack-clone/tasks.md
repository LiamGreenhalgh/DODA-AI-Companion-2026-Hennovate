# Implementation Plan: DelawareScene Full-Stack Clean-Room Reimplementation

## Overview

Implement the approved TypeScript/Node.js 22 design as a sequence of locally runnable vertical slices. Each slice must leave integrated code rather than orphaned components, use exact pinned dependencies, preserve clean-room traceability, and rely only on deterministic local fixtures during automated tests. All test tasks below are required because they are necessary for the requested working, validated site. Infrastructure work is limited to offline synthesis, assertions, and manifest diffing; no task may deploy to or mutate AWS.

## Tasks

- [ ] 1. Establish the TypeScript workspace and first runnable vertical slice
  - [ ] 1.1 Create the pinned pnpm monorepo and package boundaries
    - Create the `apps/web`, `apps/server`, `apps/worker`, and shared package layout from the design.
    - Configure Node.js 22, strict TypeScript, project references, exact dependency versions, ESLint boundaries, formatting, terminating package scripts, and a committed lockfile.
    - Configure Vitest and fast-check globally with at least 100 runs and deterministic seed replay support.
    - _Requirements: 14.7, 14.9, 14.11, 14.13_

  - [ ] 1.2 Implement shared contracts, domain primitives, and closed configuration parsing
    - Define branded identifiers, clocks, result/error types, pagination contracts, TypeBox schemas, the common API error envelope, and allowlisted configuration/secret schemas.
    - Validate all specified numeric bounds at startup and keep secret values behind `SecretProvider` interfaces.
    - _Requirements: 3.14, 4.17, 4.18, 6.6, 7.12, 9.2, 9.5–9.13, 10.8, 10.9, 15.7, 15.8_

  - [ ] 1.3 Build the initial Fastify and React application shell
    - Compose Fastify with correlation IDs, typed route registration, static Vite assets, public liveness status, and a generic safe error handler.
    - Build the React router shell with semantic landmarks, skip navigation, a single page heading, and labeled navigation placeholders for every required public workflow.
    - Add a minimal worker composition root that starts and exits cleanly under test.
    - _Requirements: 9.1, 9.10–9.12, 9.14, 11.1, 18.1_

  - [ ] 1.4 Build deterministic shared test support
    - Implement fake clocks, deterministic ID generators, typed builders, fast-check generators, disposable PostgreSQL helpers, a local-only HTTP fixture client, and a network guard that rejects non-loopback event-source traffic.
    - Add a test-result manifest format that supports fixed-data three-run determinism checks.
    - _Requirements: 14.7, 14.8, 14.9–14.12_

  - [ ] 1.5 Implement clean-room and asset-governance ledgers as validated code artifacts
    - Add schemas, parsers, and validation commands for behavior records, implementation bases, compatibility classifications, inaccessible dependencies, observable differences, evidence, asset permission bases, substitutions, attribution, and copyright notices.
    - Add a behavior registry API that enforces exactly one clean-room record for each completed behavior and excludes unlicensed assets.
    - _Requirements: 1.1–1.10, 17.10, 17.11_

  - [ ] 1.6 Add foundation unit, schema, and build tests
    - Test configuration bounds, safe error serialization, contract closure, dependency-direction enforcement, clean-room uniqueness, approximation metadata, and asset exclusion/substitution rules.
    - Verify the server, worker, and web shell type-check and build with no watcher or live-source access.
    - _Requirements: 1.2–1.10, 9.5–9.13, 14.1, 14.7, 14.8, 14.13_

- [ ] 2. Add PostgreSQL persistence and transactional infrastructure
  - [ ] 2.1 Create the initial SQL migrations and least-privilege roles
    - Add PostgreSQL enums, core source/event/job/audit/revision/settings tables, extensions, constraints, indexes, migration metadata, and separate application/auth roles.
    - Enforce restrictive foreign keys and append-only protections for provenance, audit, revision, and submission history.
    - _Requirements: 4.11–4.16, 5.3–5.15, 10.5, 12.12, 12.13, 13.8_

  - [ ] 2.2 Implement Kysely transaction, repository, and optimistic-concurrency adapters
    - Implement the transaction manager, typed row mappers, version checks, public/private projection separation, and repository ports without exposing persistence rows to routes.
    - Add a monotonic public-data revision primitive for later cache invalidation.
    - _Requirements: 4.11, 4.12, 5.14, 9.8, 9.12, 10.4, 10.7_

  - [ ] 2.3 Implement the durable job queue, audit writer, and append-only revision stores
    - Implement `FOR UPDATE SKIP LOCKED` claiming, leases, heartbeats, finite attempts, idempotency keys, and completion/failure records.
    - Implement exactly-once audit insertion and append-only source/event revision repositories inside caller-owned transactions.
    - _Requirements: 5.5, 5.7–5.10, 10.5, 12.7, 12.8, 15.3, 15.4_

  - [ ] 2.4 Add database integration infrastructure and transaction tests
    - Run production migrations against disposable PostgreSQL 16 using production-like roles.
    - Verify rollback on injected failures, append-only permissions, optimistic conflicts, job lease recovery, deterministic cleanup, and no access to developer or cloud databases.
    - _Requirements: 4.11, 4.12, 5.5, 10.4, 12.7, 12.8, 14.2, 14.3, 14.13_

- [ ] 3. Deliver the authoritative source-catalog import slice
  - [ ] 3.1 Add and identify the four authoritative CSV catalogs
    - Copy the two populated catalogs and the current library/government catalogs into `data/source-catalogs` under their exact required names without altering source bytes.
    - Add a deterministic local catalog manifest and support current zero-byte or valid header-only library/government inputs as empty categories.
    - _Requirements: 2.1–2.7_

  - [ ] 3.2 Implement RFC 4180 parsing and ordered tri-state URL normalization
    - Parse quoted records, escaped quotes, commas, CR/LF variants, multiline fields, header aliases, and first physical row locations.
    - Implement `values`, `known-absence`, and `unspecified` URL fields; semicolon splitting; ordered cardinality; scheme normalization; and strict HTTP(S) validation.
    - Accumulate deterministic field errors without persistence.
    - _Requirements: 2.5–2.21_

  - [ ] 3.3 Implement atomic catalog persistence, canonical serialization, and import commands
    - Derive categories only from exact authoritative filenames, atomically replace/upsert a validated category, default new sources to enabled, and preserve a category on any error.
    - Implement canonical RFC 4180 export/import preserving category, names, URL order/cardinality, `NKS`, and unspecified states.
    - Add terminating commands to import one catalog, import all four, and export canonical data.
    - _Requirements: 2.1–2.24, 5.11_

  - [ ] 3.4 Add catalog unit and PostgreSQL integration tests using the supplied files
    - Cover populated, empty, header-only, malformed, missing-column, missing-value, invalid-URL, quoted-comma, Unicode, semicolon, alias, and multiline cases.
    - Prove whole-file rollback, enabled defaults, physical-row errors, and successful import of all four current catalogs.
    - _Requirements: 2.1–2.24, 5.11, 14.1, 14.2_

  - [ ] 3.5 Write the property test for authoritative catalog mapping
    - **Property 1: Authoritative catalog mapping is total and category-safe**
    - Use a dedicated fast-check test with at least 100 generated catalogs and the required feature/property comment.
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.6, 2.7**

  - [ ] 3.6 Write the property test for URL-field normalization
    - **Property 2: URL-field normalization preserves ordered tri-state meaning**
    - Generate semicolon collections, explicit schemes, bare domains, `NKS`, unspecified fields, whitespace, and empty pieces.
    - **Validates: Requirements 2.8, 2.9, 2.10, 2.11, 2.12, 2.13**

  - [ ] 3.7 Write the property test for atomic invalid-catalog rejection
    - **Property 3: Invalid catalogs are rejected atomically with deterministic locations**
    - Generate each invalid class and assert zero repository writes plus stable file, row, and field metadata.
    - **Validates: Requirements 2.5, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19, 2.20, 2.21**

  - [ ] 3.8 Write the property test for canonical catalog round trips
    - **Property 4: Canonical source catalogs round-trip semantically**
    - Run at least 100 generated canonical catalogs through parse/serialize/parse while preserving all defined equality dimensions.
    - **Validates: Requirements 2.22, 2.23, 2.24, 14.9, 14.10**

- [ ] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Deliver event normalization, provenance, and deduplication
  - [ ] 5.1 Implement event, occurrence, time, normalization, and validation value objects
    - Model exact date-only values separately from timezone-qualified instants using Temporal and an injected clock.
    - Normalize title whitespace, preserve unknown optional values, retain original temporal values, and attach review issues for invalid ingested end ordering.
    - _Requirements: 4.1–4.10, 6.2, 6.8_

  - [ ] 5.2 Implement canonical identity and atomic event/provenance upserts
    - Compute the versioned length-prefixed SHA-256 identity and retain stable event IDs.
    - Atomically create/update one current event, attach all distinct provenance, and append each retrieval observation exactly once under replay/concurrency.
    - _Requirements: 3.9, 4.11–4.16, 9.3, 12.9_

  - [ ] 5.3 Implement retention settings and archival eligibility
    - Validate runtime retention updates from 0 through 3650 days while preserving the preceding value on rejection.
    - Implement a separate archival eligibility query/job that never implicitly republishes or deletes events.
    - _Requirements: 4.17–4.19, 5.9_

  - [ ] 5.4 Add normalization, identity, provenance, and persistence tests
    - Add example/boundary tests for lengths, whitespace, invalid dates, DST, timezone preservation, unknown fields, identity stability, transaction rollback, concurrency, and retention boundaries.
    - Verify an event cannot commit without provenance and unchanged retries preserve the identity set.
    - _Requirements: 4.1–4.19, 12.9, 14.1, 14.2_

  - [ ] 5.5 Write the property test for event text normalization
    - **Property 10: Event text normalization is idempotent and non-fabricating**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.10**

  - [ ] 5.6 Write the property test for occurrence parsing
    - **Property 11: Occurrence parsing preserves temporal kind and meaning**
    - **Validates: Requirements 4.4, 4.5, 4.6, 4.7**

  - [ ] 5.7 Write the property test for invalid end ordering
    - **Property 12: Invalid end ordering is retained for review, not published implicitly**
    - **Validates: Requirements 4.8, 4.9**

  - [ ] 5.8 Write the property test for deduplication and provenance union
    - **Property 13: Deduplication retains one event and all provenance**
    - Run at least 100 generated repeated/reordered equivalent source-event sets.
    - **Validates: Requirements 4.13, 4.14, 14.11, 14.12**

  - [ ] 5.9 Write the property test for exact-once same-identity updates
    - **Property 14: Same-identity updates are exact-once observations**
    - **Validates: Requirements 4.15, 4.16**

  - [ ] 5.10 Write the property test for retention boundaries
    - **Property 15: Retention settings and archive eligibility honor inclusive bounds**
    - **Validates: Requirements 4.17, 4.18, 4.19**

- [ ] 6. Deliver deterministic, bounded event ingestion
  - [ ] 6.1 Implement discovery URL selection and disjoint adapter registration
    - Select distinct URLs in catalog order, apply event-URL fallback rules, enforce the 100-URL limit, and report exact omissions.
    - Select exactly one adapter without network access; record unsupported/conflict outcomes when cardinality is not one.
    - _Requirements: 3.1–3.8_

  - [ ] 6.2 Implement the safe source HTTP and automated-access policy layer
    - Add HTTPS upgrade/no-cleartext behavior, TLS 1.2 minimum, DNS/redirect revalidation, SSRF address blocking, bounded redirects/bytes/time/content types, robots evaluation, request frequency, and bounded retry policy.
    - Fail closed on applicable prohibitions and secure-connection failures.
    - _Requirements: 3.10–3.12, 3.16, 3.17, 13.2, 13.3_

  - [ ] 6.3 Implement the generic public-web adapter and pure parsers
    - Parse bounded Schema.org JSON-LD, HTML-contained JSON-LD, iCalendar, XML sitemap, and supported JSON without scraping arbitrary visual text.
    - Traverse discoverable pages in source order and preserve source IDs, URLs, extraction format, and provenance.
    - _Requirements: 3.9–3.15, 4.10_

  - [ ] 6.4 Implement worker orchestration and durable ingestion outcomes
    - Claim jobs, enforce per-source advisory locks, exclude disabled sources before attempted counts, process each source independently, heartbeat leases, and mark interruptions safely.
    - Persist source-run outcomes and balanced run summaries while preserving all prior successfully committed events after failures.
    - _Requirements: 3.10–3.17, 5.3–5.5, 5.16, 5.17, 12.7–12.9, 15.3, 15.4_

  - [ ] 6.5 Build deterministic fixture ingestion and demo event data
    - Implement a reserved local fixture server/client and fixture adapters for successful JSON-LD, iCalendar, sitemap, pagination, failures, prohibitions, redirects, limits, and unchanged retries.
    - Add a terminating command that ingests fixtures into local PostgreSQL and creates reviewable pending demo events without contacting live third parties.
    - _Requirements: 3.9–3.17, 14.4, 14.8_

  - [ ] 6.6 Implement ingestion preparation, execution, and status interfaces
    - Return selected source identities, enabled states, total count, and selection version before enqueueing.
    - Validate page limits, reject changed selections or concurrent source runs, and expose complete run/source outcome counts through typed application interfaces and initial API routes.
    - _Requirements: 3.14, 5.1–5.5, 5.16, 5.17, 9.5, 9.7_

  - [ ] 6.7 Add adapter and ingestion integration tests
    - Exercise successful, failed, unsupported, prohibited, adapter-conflict, secure-connection, URL-limit, page-limit, no-events, interruption, lease-recovery, and unchanged-retry outcomes.
    - Assert failed responses emit no events, prior records remain unchanged, and the request ledger contains zero live third-party hosts.
    - _Requirements: 3.1–3.17, 12.7–12.9, 14.4, 14.8_

  - [ ] 6.8 Write the property test for discovery URL selection
    - **Property 5: Discovery URL selection is stable, distinct, and bounded**
    - **Validates: Requirements 3.1, 3.4, 3.5, 3.6**

  - [ ] 6.9 Write the property test for adapter cardinality
    - **Property 6: Adapter cardinality controls all requests**
    - **Validates: Requirements 3.2, 3.3, 3.7, 3.8**

  - [ ] 6.10 Write the property test for retrieval outcomes
    - **Property 7: Retrieval outcomes cannot invent events**
    - **Validates: Requirements 3.9, 3.10, 3.11**

  - [ ] 6.11 Write the property test for page traversal
    - **Property 8: Discoverable page traversal is ordered and limit-exact**
    - **Validates: Requirements 3.13, 3.14, 3.15**

  - [ ] 6.12 Write the property test for access prohibitions
    - **Property 9: Automated-access prohibitions are fail-closed**
    - **Validates: Requirements 3.16, 3.17**

  - [ ] 6.13 Write the property test for run-summary invariants
    - **Property 16: Ingestion summaries are nonnegative and balanced**
    - **Validates: Requirements 5.3, 5.4**

- [ ] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Deliver public event discovery through the API and website
  - [ ] 8.1 Implement published-upcoming event queries and deterministic pagination
    - Capture one page-open instant, apply Delaware date rules, implement the complete occurrence ordering tuple, and return stable pages with total/previous/next metadata.
    - Display all required non-empty summary attributes and preserve exact date-only values.
    - _Requirements: 6.1–6.10, 9.2–9.4_

  - [ ] 8.2 Implement search, filters, metadata, and URL-state codecs
    - Implement trimmed contiguous case-insensitive search across every required field, AND-between/OR-within filter composition, supported metadata, canonical URL encoding/decoding, ignored unsupported values, and overlength preservation semantics.
    - _Requirements: 7.1–7.13, 9.5–9.8_

  - [ ] 8.3 Implement public event detail projection
    - Return every known public field, future occurrences in source timezones, exact stored external URLs, address/coordinate/ticket/registration/cost values, and no fabricated values.
    - Make unknown and unpublished records observationally identical and exclude every moderation/existence indicator.
    - _Requirements: 8.1–8.10, 9.9, 9.14_

  - [ ] 8.4 Expose versioned public routes and machine-readable schemas
    - Implement `/api/v1/events`, event detail, search metadata, live/ready health, typed pagination links, field-specific 400s, identical 404s, safe 500s, and the initial OpenAPI 3.1 document.
    - Keep public DTOs separate from moderation entities.
    - _Requirements: 9.1–9.14_

  - [ ] 8.5 Implement accessible public layout and reusable UI primitives
    - Build `Field`, `FilterGroup`, `ResultsStatus`, `ExternalLink`, `Pagination`, `Dialog`, and responsive table/card primitives with semantic HTML and keyboard behavior.
    - Implement responsive navigation for events, regions, features, podcasts, opportunities, organization access, and submissions without protected assets.
    - _Requirements: 1.8–1.10, 8.9, 11.1–11.10, 18.1_

  - [ ] 8.6 Build event index, search/filter, and detail routes
    - Wire the generated client to upcoming pages, URL restoration within one second, clear/reset behavior, retained overlong input and preceding results, no-results controls, live result announcements, and exact external-link notices.
    - Render event details and not-found states without leaking unpublished existence.
    - _Requirements: 6.1–6.12, 7.6–7.13, 8.1–8.10, 11.7–11.10_

  - [ ] 8.7 Add public-query unit, database, and API contract tests
    - Cover Delaware dates, DST, ordering ties, page bounds/coverage, search/filter combinations, invalid parameters, stable IDs, immutable repeated requests, field projection, 404 equivalence, and safe 500 responses.
    - Validate public route responses against OpenAPI schemas.
    - _Requirements: 6.1–6.12, 7.1–7.13, 8.1–8.10, 9.1–9.14, 14.1, 14.2, 14.5_

  - [ ] 8.8 Add automated browser and accessibility tests for event journeys
    - Cover browse upcoming events, search/filter/deep-link/reload/clear, event detail, and exact original-source navigation in Chromium, Firefox, and WebKit.
    - Test keyboard operation, visible focus, no traps, live announcements, error associations, and 1280×1024 at 400% zoom without horizontal page scrolling, clipping, or overlap.
    - _Requirements: 6.1–6.12, 7.6–7.13, 8.1–8.10, 11.1–11.10, 14.6_

  - [ ] 8.9 Write the property test for public event selection
    - **Property 20: Public event selection exposes exactly published upcoming occurrences**
    - **Validates: Requirements 6.1, 6.2**

  - [ ] 8.10 Write the property test for occurrence ordering
    - **Property 21: Public occurrence ordering is a deterministic total order**
    - **Validates: Requirements 6.3, 6.4, 6.5**

  - [ ] 8.11 Write the property test for pagination coverage
    - **Property 22: Collection pagination has complete, duplicate-free coverage**
    - **Validates: Requirements 6.6, 6.7, 9.2, 18.3, 18.6, 18.8, 18.11, 18.16**

  - [ ] 8.12 Write the property test for contiguous search matching
    - **Property 23: Search normalization and contiguous matching agree with a reference model**
    - **Validates: Requirements 7.1, 7.2, 7.13**

  - [ ] 8.13 Write the property test for filter composition
    - **Property 24: Filter composition is AND between groups and OR within groups**
    - **Validates: Requirements 7.3, 7.4, 7.5**

  - [ ] 8.14 Write the property test for search URL state
    - **Property 25: Search URL state round-trips and tolerates unsupported values**
    - **Validates: Requirements 7.7, 7.8, 7.9**

  - [ ] 8.15 Write the property test for overlong searches
    - **Property 26: Overlong searches fail without replacing prior results**
    - **Validates: Requirements 7.11, 7.12**

  - [ ] 8.16 Write the property test for public detail projection
    - **Property 27: Public detail projection is complete but never fabricated**
    - **Validates: Requirements 8.1, 8.3, 8.4, 8.5, 8.6, 8.10**

  - [ ] 8.17 Write the property test for detail occurrence filtering
    - **Property 28: Detail recurrence filtering uses each source timezone**
    - **Validates: Requirements 8.2**

  - [ ] 8.18 Write the property test for hidden event details
    - **Property 29: Unknown and unpublished event details are observationally indistinguishable**
    - **Validates: Requirements 8.7, 8.8**

  - [ ] 8.19 Write the property test for stable IDs and repeated queries
    - **Property 30: Stable event IDs and immutable queries are deterministic**
    - **Validates: Requirements 9.3, 9.4**

  - [ ] 8.20 Write the property test for invalid API parameters
    - **Property 31: Invalid API parameters are side-effect free**
    - **Validates: Requirements 9.5, 9.6, 9.7, 9.8**

  - [ ] 8.21 Write the property test for unauthenticated projections
    - **Property 32: Unauthenticated projections are public-only**
    - **Validates: Requirements 9.14**

- [ ] 9. Deliver authentication, ingestion controls, and moderation
  - [ ] 9.1 Implement credentials, sessions, bootstrap, and secret isolation
    - Implement Argon2id hashing, envelope-encrypted credential storage, opaque session digests, absolute/idle expiry, rotation/revocation, generic login failures, and an interactive/Docker-secret bootstrap command.
    - Store only the permitted account identifier, role, and audit data outside the credential vault; redact all auth material.
    - _Requirements: 10.1, 10.2, 10.6–10.9, 13.7, 13.8_

  - [ ] 9.2 Implement authorization and browser-request integrity
    - Add editor/contributor role policies, synchronizer CSRF tokens bound to session/action, anonymous form sessions, Origin/Fetch Metadata checks, and authorization-before-protected-load behavior.
    - Return 401 for missing/invalid/expired credentials and 403 for insufficient roles or integrity failures with no target mutation.
    - _Requirements: 10.1–10.7, 13.4, 13.11_

  - [ ] 9.3 Implement moderation transitions, source controls, revisions, and audits
    - Implement legal event status transitions, rejection-reason bounds, corrected-field history, source enabled/disabled state changes, ingestion selection confirmation, and exactly one audit per successful action.
    - Enforce idempotency keys, optimistic versions, advisory source locks, and aggregate preservation on invalid commands.
    - _Requirements: 5.1–5.17, 10.3–10.5_

  - [ ] 9.4 Build authentication and moderation API/UI routes
    - Implement login/logout/session, protected source/run/event queues, prepare/run/status, approve/reject/archive/correct/source-state endpoints, and safe moderation DTOs.
    - Build accessible login, source review, run outcome, event review, revision, and alert placeholders using responsive tables/cards.
    - _Requirements: 5.1–5.17, 10.1–10.7, 11.1–11.8_

  - [ ] 9.5 Add moderation unit, integration, contract, and browser tests
    - Verify every valid/invalid transition, reason boundary, exact audit/revision content, source-state effects, concurrent-run rejection, idempotent replay, 401/403 behavior, CSRF denial, and unchanged database state after unauthorized requests.
    - Automate editor login, fixture-run preparation/execution, outcome review, and event approval/rejection/archive journeys.
    - _Requirements: 5.1–5.17, 10.1–10.7, 13.4, 13.11, 14.1–14.6_

  - [ ] 9.6 Write the property test for valid moderation transitions
    - **Property 17: Valid event moderation transitions are exact and audited**
    - **Validates: Requirements 5.6, 5.7, 5.8, 5.9, 5.10, 10.5**

  - [ ] 9.7 Write the property test for invalid moderation commands
    - **Property 18: Invalid moderation commands preserve the aggregate**
    - **Validates: Requirements 5.14, 5.15**

  - [ ] 9.8 Write the property test for source state behavior
    - **Property 19: Source state changes are audited and disabled sources are invisible to retrieval**
    - **Validates: Requirements 5.12, 5.13, 5.16, 5.17**

  - [ ] 9.9 Write the property test for unauthorized operations
    - **Property 33: Unauthorized protected operations disclose and mutate nothing**
    - **Validates: Requirements 10.4, 13.11**

  - [ ] 9.10 Write the property test for request-integrity failures
    - **Property 36: Invalid request-integrity evidence cannot mutate state**
    - **Validates: Requirements 13.4**

- [ ] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Deliver regions, editorial features, podcasts, opportunities, and organizations
  - [ ] 11.1 Implement public-content models and repositories
    - Add migrations and typed repositories for regions, approved organization profiles/contributors, editorial features and ordered event links, podcast entries, arts opportunities, immutable slugs, attribution, and rights notices.
    - Implement current/future/published predicates and collection maximums without exposing nonqualifying records.
    - _Requirements: 1.8, 18.2–18.17_

  - [ ] 11.2 Implement public-content and moderation interfaces
    - Add versioned APIs for region events, features, podcasts, current opportunities, and organization profiles with deterministic pagination and exact external URLs.
    - Add editor transitions for features, podcasts, opportunities, and profiles using existing audit/idempotency infrastructure.
    - _Requirements: 18.2–18.17, 10.5_

  - [ ] 11.3 Build the public home and content routes
    - Complete home navigation and implement accessible region, feature, podcast, opportunity, and organization pages with no-results handling, external notices, stable URLs, attribution, and responsive pagination.
    - Add moderation views required to publish and maintain the content.
    - _Requirements: 1.8–1.10, 11.1–11.10, 18.1–18.17_

  - [ ] 11.4 Add public-content unit, database, contract, E2E, and accessibility tests
    - Cover stable slugs after edits, publication filtering, order, inclusive deadlines, region qualification, organization association, pagination coverage, no-results privacy, exact links, keyboard paths, and reflow.
    - _Requirements: 11.1–11.10, 14.2, 14.5, 14.6, 18.1–18.17_

  - [ ] 11.5 Write the property test for regional discovery
    - **Property 44: Region discovery returns only published qualifying events**
    - **Validates: Requirements 18.2**

  - [ ] 11.6 Write the property test for editorial feature links
    - **Property 45: Editorial features cannot expose non-published linked events**
    - **Validates: Requirements 18.5**

  - [ ] 11.7 Write the property test for podcast ordering
    - **Property 46: Podcast indexes are published-only and newest-first**
    - **Validates: Requirements 18.7**

  - [ ] 11.8 Write the property test for current opportunities
    - **Property 47: Current opportunity selection has an inclusive Delaware deadline**
    - **Validates: Requirements 18.10, 18.12, 18.13**

  - [ ] 11.9 Write the property test for organization public views
    - **Property 48: Organization public views expose only associated future published events**
    - **Validates: Requirements 18.15, 18.17**

- [ ] 12. Deliver organization, event, correction, and opportunity submissions
  - [ ] 12.1 Implement immutable submission persistence and contributor relationships
    - Add base/per-kind tables, occurrence uniqueness/order, encrypted source network addresses, consent/terms metadata, eligibility state, approved-target uniqueness, contributor/profile links, and append-only payload/history repositories.
    - _Requirements: 19.7–19.10, 19.14, 19.17, 19.19, 19.21, 19.25, 19.29, 19.30, 19.36_

  - [ ] 12.2 Implement submission validation, literal-text safety, and eligibility policy
    - Accumulate field errors for all exact bounds and contact/URL types before persistence.
    - Reject executable markup/payloads and disallowed URL schemes atomically while preserving ordinary literal text.
    - Implement occurrence validation/de-duplication, participation restrictions, the versioned Delaware boundary distance policy, and manual-check behavior when coordinates are unavailable.
    - _Requirements: 13.1, 19.1–19.6, 19.11–19.15, 19.22–19.24, 19.27–19.36_

  - [ ] 12.3 Implement submission and approval workflows
    - Implement organization intake/approval, contributor event intake/eligibility/approval, public correction requests with explicit approved-field masks, and opportunity intake/approval.
    - Make every accepted intake/decision atomic, idempotent, fully revised/audited, and linked to exactly one target where applicable.
    - _Requirements: 19.7–19.10, 19.16–19.21, 19.25, 19.26_

  - [ ] 12.4 Build submission APIs, forms, and moderation queues
    - Add form-session bootstrapping and versioned endpoints for all submission kinds with field-specific errors and safe retained values.
    - Build accessible organization, event, correction, and opportunity forms plus contributor/editor queues using semantic fields, summaries, and responsive layouts.
    - _Requirements: 9.5, 10.1–10.7, 11.1–11.10, 19.1–19.36_

  - [ ] 12.5 Add submission unit, database, and contract tests
    - Cover every exact length/count boundary, contact type, URL scheme, unsafe payload, consent/terms requirement, distance/restriction outcome, approval field mask, transaction rollback, idempotent replay, and OpenAPI response.
    - _Requirements: 13.1, 14.1–14.5, 19.1–19.36_

  - [ ] 12.6 Add submission E2E and accessibility journeys
    - Automate successful organization profile submission, contributor event submission, correction request, and opportunity submission/moderation with deterministic local data.
    - Verify keyboard-only operation, focus/error associations, safe value retention, status announcements, and 400% reflow for every form and queue.
    - _Requirements: 11.1–11.10, 14.6, 19.1–19.36_

  - [ ] 12.7 Write the property test for organization submissions
    - **Property 49: Organization submission workflow is complete and idempotent**
    - **Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9**

  - [ ] 12.8 Write the property test for contributor event eligibility
    - **Property 50: Contributor event intake enforces linkage and public eligibility**
    - **Validates: Requirements 19.10, 19.11, 19.12, 19.13**

  - [ ] 12.9 Write the property test for submitted occurrences
    - **Property 51: Event-submission occurrences are bounded, ordered, and valid**
    - **Validates: Requirements 19.14, 19.15, 19.34**

  - [ ] 12.10 Write the property test for event/correction approvals
    - **Property 52: Approved event and correction changes are selective, historical, and audited**
    - **Validates: Requirements 19.16, 19.17, 19.18, 19.19, 19.20, 19.21**

  - [ ] 12.11 Write the property test for opportunity submissions
    - **Property 53: Opportunity submissions obey content, timing, and lifecycle bounds**
    - **Validates: Requirements 19.22, 19.23, 19.24, 19.25, 19.26, 19.35**

  - [ ] 12.12 Write the property test for unsafe submissions
    - **Property 54: Unsafe submission payloads and schemes are atomically rejected**
    - **Validates: Requirements 19.27, 19.28**

  - [ ] 12.13 Write the property test for submission metadata
    - **Property 55: Accepted submissions record required trustworthy metadata**
    - **Validates: Requirements 19.29, 19.30, 19.36**

  - [ ] 12.14 Write the property test for event/correction text bounds
    - **Property 56: Event and correction text bounds are exact**
    - **Validates: Requirements 19.31, 19.32, 19.33**

- [ ] 13. Add security, observability, reliability, backup, and performance behavior
  - [ ] 13.1 Implement structured logs, correlation, metrics, and recursive redaction
    - Emit bounded JSON request/source-run logs with required timestamps, route templates, statuses, durations, counts, and correlation IDs within the specified intervals.
    - Expose protected metrics for request count/latency/errors, ingestion, freshness, published events, jobs, and alerts while recursively redacting secrets and submitted sensitive values.
    - _Requirements: 9.10, 9.11, 13.7, 15.1–15.6_

  - [ ] 13.2 Implement transport/security middleware and rolling public rate limits
    - Configure TLS 1.2+ listeners/clients, HSTS/CSP/security headers, secure cookies, literal rendering, parameterized repositories, and a rolling 60-request/60-second attributed limiter with bounded `Retry-After`.
    - _Requirements: 13.1–13.7_

  - [ ] 13.3 Implement freshness evaluation and durable alert/outbox state machines
    - Validate freshness settings, transition stale source state, evaluate request-error and consecutive-source-failure conditions, suppress duplicates, recover conditions, and retry failed alert delivery at exact intervals/counts.
    - _Requirements: 15.7–15.18_

  - [ ] 13.4 Implement public caching, readiness/liveness, and interruption recovery
    - Add bounded revision-keyed public caches, dependency-aware readiness within five seconds, dependency-independent liveness, worker lease failure/recovery, and unchanged-source idempotency.
    - _Requirements: 12.7–12.11_

  - [ ] 13.5 Implement verified backup/restore and release/rollback records
    - Add terminating backup and empty-environment restore commands with manifests for counts, stable IDs, statuses, fields, provenance, and moderation relationships.
    - Implement immutable release records and a pure immediately-preceding-release eligibility selector that never modifies persisted event data.
    - _Requirements: 12.12, 12.13, 16.10–16.13, 16.15_

  - [ ] 13.6 Add observability and reliability integration tests
    - Verify log timing/shape/redaction, metric refresh, stale transitions, alert suppression/recovery/retries, cache invalidation, database-outage readiness/liveness, interrupted ingestion, backup/restore equality, and rollback selection.
    - _Requirements: 12.7–12.13, 13.7, 15.1–15.18, 16.12, 16.13, 16.15_

  - [ ] 13.7 Implement terminating security validation commands
    - Add SAST/lint rules, secret scanning, exact-lockfile dependency scanning, container scanning hooks, HTTP header/session/CSRF/SSRF tests, unsafe-payload corpus tests, and fail-closed handling for critical findings or incomplete required scans.
    - Ensure scans identify the component and scan and return nonzero without transmitting project code, secrets, or user data.
    - _Requirements: 13.1–13.11, 14.13_

  - [ ] 13.8 Implement deterministic performance and load-test code
    - Generate exactly 100,000 deterministic events and add one-shot k6 scenarios for cached list/detail at 50 rps for 10 minutes and uncached search at 20 rps for 10 minutes.
    - Assert the required latency/success thresholds, emit resource/query-plan context, and provide a shorter non-watch smoke profile.
    - _Requirements: 12.1–12.6, 14.13_

  - [ ] 13.9 Write the property test for unchanged-source idempotency
    - **Property 34: Re-ingesting unchanged source data is idempotent**
    - **Validates: Requirements 12.9**

  - [ ] 13.10 Write the property test for literal user text
    - **Property 35: Accepted user text remains literal data**
    - **Validates: Requirements 13.1**

  - [ ] 13.11 Write the property test for rolling rate limits
    - **Property 37: Public rate limiting is rolling-window exact and bounded**
    - **Validates: Requirements 13.5, 13.6**

  - [ ] 13.12 Write the property test for log redaction
    - **Property 38: Operational-log serialization redacts sensitive values**
    - **Validates: Requirements 13.7**

  - [ ] 13.13 Write the property test for freshness state
    - **Property 39: Freshness configuration and stale-state transitions are boundary-correct**
    - **Validates: Requirements 15.7, 15.8, 15.9, 15.10**

  - [ ] 13.14 Write the property test for request-error alerts
    - **Property 40: Request-error alerts have threshold hysteresis and deduplication**
    - **Validates: Requirements 15.11, 15.12, 15.13**

  - [ ] 13.15 Write the property test for source-failure alerts
    - **Property 41: Consecutive source-failure alerts reset only on success**
    - **Validates: Requirements 15.14, 15.15, 15.16**

  - [ ] 13.16 Write the property test for alert delivery retries
    - **Property 42: Alert delivery failures remain visible and retry finitely**
    - **Validates: Requirements 15.17, 15.18**

  - [ ] 13.17 Write the property test for rollback eligibility
    - **Property 43: Rollback selects only the immediately preceding eligible release**
    - **Validates: Requirements 16.12, 16.15**

- [ ] 14. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Package and validate the complete local application
  - [ ] 15.1 Implement deterministic local setup, seed, and demo commands
    - Wire migrations, all-four-catalog import, local editor/contributor bootstrap, fixture ingestion, public-content seeds, and approved demo records into idempotent terminating commands.
    - Keep secrets in interactive input/Docker secrets and make every demo/test path incapable of contacting live event sources.
    - _Requirements: 2.1–2.24, 10.8, 10.9, 14.8, 17.1–17.4_

  - [ ] 15.2 Create the hardened multi-stage OCI image
    - Build web/worker artifacts from the exact lockfile, prune development dependencies, run as a numeric non-root user, support a read-only root filesystem, and select web/worker by command.
    - Embed an immutable 1–128 character release identifier tied to the exact source revision without embedding secrets.
    - _Requirements: 13.9, 13.10, 16.10, 16.11_

  - [ ] 15.3 Create the local Compose application stack
    - Define TLS-enabled PostgreSQL, web, and worker services with health dependencies, named data storage, Docker secrets, and only the HTTPS web port exposed to browsers.
    - Wire deterministic fixture/demo services only in explicit local profiles.
    - _Requirements: 10.8, 10.9, 12.10, 12.11, 13.2, 13.3, 16.10, 16.11_

  - [ ] 15.4 Complete OpenAPI generation, typed client generation, and exhaustive contract enumeration
    - Generate the full OpenAPI 3.1 document/client for every public, auth, submission, moderation, content, health, and operational route.
    - Add a contract enumerator that exercises every documented success and error response, validates auth/bounds/purpose metadata, and detects undocumented runtime responses.
    - _Requirements: 9.1–9.14, 14.5_

  - [ ] 15.5 Complete deterministic cross-workflow E2E coverage
    - Add one successful automated browser test for every Critical_User_Journey and cover no-results, stable URLs, role denial, CSRF denial, invalid-value retention, and identical hidden-event responses.
    - Run against deterministic local seed/fixtures only and add a three-execution pass/fail manifest comparison.
    - _Requirements: 14.6–14.8, 18.1–18.17, 19.1–19.36_

  - [ ] 15.6 Complete automated accessibility and responsive validation
    - Run axe-core over every required public/auth/moderation/submission route and automate keyboard, focus, live-region, form-error, text-alternative, external-link, and 400% reflow checks.
    - Add a machine-validated WCAG evidence matrix data file so missing route/criterion evidence fails release validation.
    - _Requirements: 11.1–11.10, 14.13_

  - [ ] 15.7 Implement handoff metadata generation and clean-room coverage gates
    - Create typed manifests and generators for setup/config/import/adapter/moderation/backup/restore/release procedures, external services/assumptions, adapter readiness, cost-bearing resource inventory, unresolved deployment decisions, and clean-room differences/statuses.
    - Validate prerequisites, inputs, ordered actions, success/recovery indicators, dependency effects, adapter limits/outcomes, cost assumptions, and exactly one basis per completed behavior.
    - _Requirements: 1.1–1.10, 17.1–17.11_

  - [ ] 15.8 Implement the terminating release-validation orchestrator
    - Wire typecheck, lint, unit/property, integration, ingestion, contract, E2E, accessibility, security, performance evidence, backup/restore, clean-room/coverage gates, image checks, and infrastructure validation into one non-watch command.
    - Fail nonzero on any required failure, missing test mapping, duplicated/missing property implementation, fewer than 100 property runs, missing critical journey, incomplete scan, or live-source request.
    - _Requirements: 13.9, 13.10, 14.1–14.13, 17.1–17.11_

- [ ] 16. Add offline-only ECS infrastructure readiness
  - [ ] 16.1 Create the pinned CDK v2 ECS Fargate application
    - Define VPC/subnet boundaries, HTTPS ALB, ECS cluster, separate web/worker services, RDS PostgreSQL, secret references, logs/metrics/alarms, health checks, immutable image input, and external certificate/DNS/alert inputs without lookups.
    - Do not add EKS constructs or any deploy command.
    - _Requirements: 16.1, 16.6, 16.8_

  - [ ] 16.2 Implement validated infrastructure inputs and scaling/network policies
    - Validate minimum/maximum scaling as whole numbers from 1 through 100 with `min <= max` and model task/network/database/secret/log connectivity explicitly.
    - Make unresolved environment/account/region/certificate/DNS/image/alert values explicit inputs rather than assumptions.
    - _Requirements: 16.1, 16.6–16.9, 17.8, 17.9_

  - [ ] 16.3 Implement fail-closed deployment-decision and rollback guards without deploying
    - Add schemas and pure validation for authorized ECS runtime/environment/account/region/approver/expiry/stacks/rollback, and ensure ordinary synthesized assemblies contain a deployment-denial guard.
    - Provide no default `deploy` script; any future mutating wrapper must reject absent/invalid authorization before invoking a provider and must never be executed by this plan.
    - _Requirements: 16.2, 16.5, 16.12, 16.13, 16.15_

  - [ ] 16.4 Implement normalized offline synthesis and resource-manifest diffing
    - Add `infra:validate` to type-check, synthesize locally without credentials, lint templates, normalize the resource manifest, and list every addition/modification/deletion or explicitly report no changes.
    - Guarantee the command applies no proposed change and accumulates all detectable validation errors.
    - _Requirements: 16.2–16.5, 16.14_

  - [ ] 16.5 Add CDK assertions and no-mutation infrastructure tests
    - Assert ECS resources, network boundaries, TLS health paths, database connectivity, secret references, logs, scaling bounds, immutable image metadata, absence of EKS, and no environment lookup.
    - Test invalid decisions, guarded assemblies, addition/modification/deletion/no-change diffs, aggregate validation errors, rollback eligibility, and zero cloud-mutation calls.
    - _Requirements: 16.1–16.15_

  - [ ] 16.6 Add container, release-manifest, and offline-infrastructure smoke tests
    - Verify web/worker commands run as non-root, liveness/readiness behavior, read-only compatibility, exact revision/image binding, no secrets in layers, and local-only CDK synthesis without AWS credentials.
    - Confirm every project-supported infrastructure command used by validation is non-mutating.
    - _Requirements: 10.9, 12.10, 12.11, 13.9, 13.10, 16.1–16.15_

- [ ] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All implementation uses TypeScript on Node.js 22 as selected by the approved design.
- No sub-task is marked optional: the requested site, backend, demo data, all specified test layers, containerization, and offline infrastructure validation are required for completion.
- Every property task must contain exactly one top-level `fc.assert`, use the exact design property comment format, run at least 100 generated cases, and record replayable seed/path data.
- Tests must use fixed local data and injected fixture clients; no automated test may request a live third-party event source.
- All commands created for validation must terminate. Developer-run servers/watchers remain manual and are not implementation tasks.
- Infrastructure tasks may synthesize, assert, and diff local templates only. They must not obtain AWS credentials, deploy a stack, or create, update, or delete any AWS resource.
- Each task references granular requirements for traceability; the release coverage gate must map every acceptance criterion to executable evidence.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.5"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["1.6", "2.2"] },
    { "id": 4, "tasks": ["2.3"] },
    { "id": 5, "tasks": ["2.4", "3.1"] },
    { "id": 6, "tasks": ["3.2"] },
    { "id": 7, "tasks": ["3.3"] },
    { "id": 8, "tasks": ["3.4", "3.5", "3.6", "3.7", "3.8"] },
    { "id": 9, "tasks": ["5.1"] },
    { "id": 10, "tasks": ["5.2", "5.3"] },
    { "id": 11, "tasks": ["5.4", "5.5", "5.6", "5.7", "5.8", "5.9", "5.10"] },
    { "id": 12, "tasks": ["6.1"] },
    { "id": 13, "tasks": ["6.2", "6.3"] },
    { "id": 14, "tasks": ["6.4", "6.5"] },
    { "id": 15, "tasks": ["6.6"] },
    { "id": 16, "tasks": ["6.7", "6.8", "6.9", "6.10", "6.11", "6.12", "6.13"] },
    { "id": 17, "tasks": ["8.1", "8.2", "8.3"] },
    { "id": 18, "tasks": ["8.4", "8.5"] },
    { "id": 19, "tasks": ["8.6"] },
    { "id": 20, "tasks": ["8.7", "8.9", "8.10", "8.11", "8.12", "8.13", "8.14", "8.15", "8.16", "8.17", "8.18", "8.19", "8.20", "8.21"] },
    { "id": 21, "tasks": ["8.8"] },
    { "id": 22, "tasks": ["9.1"] },
    { "id": 23, "tasks": ["9.2", "9.3"] },
    { "id": 24, "tasks": ["9.4"] },
    { "id": 25, "tasks": ["9.5", "9.6", "9.7", "9.8", "9.9", "9.10"] },
    { "id": 26, "tasks": ["11.1", "12.1", "13.1"] },
    { "id": 27, "tasks": ["11.2", "12.2", "13.2"] },
    { "id": 28, "tasks": ["11.3", "12.3", "13.3"] },
    { "id": 29, "tasks": ["11.4", "11.5", "11.6", "11.7", "11.8", "11.9", "12.4", "13.4"] },
    { "id": 30, "tasks": ["12.5", "12.6", "12.7", "12.8", "12.9", "12.10", "12.11", "12.12", "12.13", "12.14", "13.5"] },
    { "id": 31, "tasks": ["13.6", "13.7", "13.8", "13.9", "13.10", "13.11", "13.12", "13.13", "13.14", "13.15", "13.16", "13.17"] },
    { "id": 32, "tasks": ["15.1", "15.2", "15.4", "15.7"] },
    { "id": 33, "tasks": ["15.3", "15.5", "15.6"] },
    { "id": 34, "tasks": ["15.8"] },
    { "id": 35, "tasks": ["16.1"] },
    { "id": 36, "tasks": ["16.2", "16.3"] },
    { "id": 37, "tasks": ["16.4"] },
    { "id": 38, "tasks": ["16.5"] },
    { "id": 39, "tasks": ["16.6"] }
  ]
}
```

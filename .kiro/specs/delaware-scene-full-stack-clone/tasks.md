# Implementation Plan: DelawareScene Full-Stack Clean-Room Reimplementation

## Overview

Implement the approved TypeScript/Node.js 22 design as integrated vertical slices spanning the public application, ingestion and moderation services, deterministic validation, immutable release packaging, AWS CDK v2 infrastructure, and guarded ECS Fargate deployment automation. Each task produces code, configuration, generated artifacts, or automated tests; all tasks are directly executable by a coding agent and contain no manual acceptance activity. Deployment code must fail closed unless it receives a valid sealed plan, and planning/test modes must prove zero Cloud_Mutations. Generating this plan does not execute AWS commands or deploy resources.

## Tasks

Parent-task requirement traceability: Task 1 → 1.1–1.10, 9.1–9.14, 14.7–14.13; Task 2 → 2.1–2.24, 4.11–4.16, 5.15; Task 3 → 3.1–3.19, 4.1–4.19, 5.1–5.23; Task 4 → 6.1–6.17, 7.1–7.16, 8.1–8.11, 9.1–9.18, 11.1–11.10; Task 5 → 5.1–5.23, 10.1–10.10, 13.4, 13.11; Task 6 → 18.1–18.29, 19.1–19.45; Task 7 → 12.1–12.13, 13.1–13.11, 15.1–15.18; Task 8 → 14.1–14.13, 17.1–17.11; Task 9 → 16.1–16.28; Task 10 → 16.30–16.80; Task 11 → 16.36–16.54, 16.80, 16.94–16.97; Task 12 → 16.17–16.27, 16.40–16.97. Each correctness-property subtask creates its own test file so tasks scheduled in the same wave do not target the same file.

- [ ] 1. Establish the TypeScript workspace and executable application foundation
  - [ ] 1.1 Create the pinned pnpm monorepo and enforce package boundaries
    - Create the `apps/web`, `apps/server`, `apps/worker`, shared packages, scripts, tests, clean-room, and `infra/cdk` workspaces with Node.js 22, strict TypeScript project references, exact dependency versions, a committed lockfile, and non-watch validation scripts.
    - Enforce the design dependency direction with lint rules and prohibit framework, network, process-environment, clock, random, and persistence imports from the domain package.
    - _Requirements: 14.7, 14.13, 16.1, 17.1_

  - [ ] 1.2 Implement shared contracts, domain primitives, and closed configuration parsing
    - Define branded identifiers, injected clocks/ID generators, result and validation-error types, publication/source enums, pagination contracts, TypeBox schemas, and separate secret/non-secret configuration schemas.
    - Validate application bounds at startup while preserving runtime settings on rejected updates and keeping Secret_Values behind provider interfaces.
    - _Requirements: 3.14, 3.18, 3.19, 4.17, 4.18, 6.6, 6.7, 9.2, 9.5–9.13, 10.8, 10.9, 15.7, 15.8_

  - [ ] 1.3 Build the initial Fastify, React, and worker composition roots
    - Compose Fastify with typed route registration, correlation identifiers, safe error mapping, OpenAPI generation hooks, static Vite assets, and distinct liveness/readiness endpoints.
    - Build the React router shell with semantic landmarks and labeled navigation for every public, organization, submission, and moderation workflow; add a worker root with bounded polling and clean shutdown.
    - _Requirements: 9.1, 9.10–9.14, 11.1, 18.1_

  - [ ] 1.4 Build deterministic shared test infrastructure
    - Implement fake clocks, deterministic IDs, typed builders, fast-check generators configured for at least 100 runs, disposable PostgreSQL helpers, fixture HTTP clients, and a non-loopback network guard.
    - Add replayable seed/path reporting and a fixed-data three-run result-manifest comparator.
    - _Requirements: 14.7–14.12_

  - [ ] 1.5 Implement clean-room and asset-governance ledgers
    - Add schemas, parsers, registries, and validation commands for exactly one implementation basis per completed behavior, approximation/unsupported metadata, evidence references, asset permissions, substitutions, attribution, and rights notices.
    - Make release validation reject missing/duplicate behavior records and use of assets without a recorded permission or substitute basis.
    - _Requirements: 1.1–1.10, 17.10, 17.11_

  - [ ] 1.6 Add foundation build, schema, and boundary tests
    - Test closed contracts, numeric bounds, safe error serialization, dependency boundaries, behavior-ledger uniqueness, approximation metadata, and protected-asset exclusion.
    - Verify the server, worker, and web shells type-check and build without watchers, secrets, or live event-source traffic.
    - _Requirements: 1.2–1.10, 9.5–9.13, 14.1, 14.7, 14.8, 14.13_

- [ ] 2. Implement PostgreSQL persistence and authoritative catalog import
  - [ ] 2.1 Create production SQL migrations and least-privilege database roles
    - Add enums, source/event/provenance/job/audit/revision/settings/auth/content/submission/operations tables, constraints, extensions, deterministic indexes, and migration metadata.
    - Enforce restrictive foreign keys, append-only history, public/private projection boundaries, and separate runtime, auth-vault, and migration privileges.
    - _Requirements: 4.11–4.16, 5.8–5.23, 10.5, 10.8, 12.12, 12.13, 13.8_

  - [ ] 2.2 Implement transaction, repository, concurrency, and durable-job adapters
    - Implement Kysely transaction management, typed mappers, optimistic versions, advisory locks, idempotency records, public-data revision, and `FOR UPDATE SKIP LOCKED` jobs with leases, heartbeats, finite attempts, completion, and failure states.
    - Keep persistence rows out of HTTP handlers and make target, provenance, audit, and revision writes participate in caller-owned Atomic_Operations.
    - _Requirements: 4.11–4.16, 5.5, 5.18–5.23, 10.4, 10.5, 10.10, 12.7–12.9, 15.3, 15.4_

  - [ ] 2.3 Add and identify all four authoritative catalogs
    - Copy the supplied CSV bytes under the exact required names, generate a deterministic local manifest, and represent the current empty library/government files as valid empty category inputs.
    - _Requirements: 2.1–2.7_

  - [ ] 2.4 Implement RFC 4180 parsing and ordered tri-state URL normalization
    - Parse quoted/multiline records with physical row locations, accepted header aliases, UTF-8, and complete deterministic error accumulation.
    - Implement ordered semicolon URL collections, `NKS` known absence, unspecified state, bare-domain HTTPS normalization, explicit HTTP/HTTPS preservation, and strict absolute URL rejection rules.
    - _Requirements: 2.5–2.21_

  - [ ] 2.5 Implement atomic catalog persistence, canonical serialization, and commands
    - Derive categories only from exact filenames, default imported sources to enabled, replace a validated category atomically, and preserve preceding data on any parse or persistence failure.
    - Implement canonical RFC 4180 serialization/import preserving category, names, URL cardinality/order, `NKS`, and unspecified states, plus terminating import-one/import-all/export commands.
    - _Requirements: 2.1–2.24, 5.15_

  - [ ] 2.6 Add catalog and persistence example/integration tests
    - Exercise supplied populated/empty catalogs, header-only input, aliases, Unicode, multiline/quoted records, malformed grammar, missing fields/columns, invalid URLs, transaction rollback, physical-row errors, enabled defaults, append-only permissions, and job lease recovery.
    - _Requirements: 2.1–2.24, 5.15, 14.1–14.3, 14.13_

  - [ ] 2.7 Write the property test for authoritative catalog mapping
    - **Property 1: Authoritative catalog mapping is total and category-safe**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.6, 2.7**

  - [ ] 2.8 Write the property test for URL-field normalization
    - **Property 2: URL-field normalization preserves ordered tri-state meaning**
    - **Validates: Requirements 2.8–2.13**

  - [ ] 2.9 Write the property test for invalid-catalog atomicity
    - **Property 3: Invalid catalogs are rejected atomically with deterministic locations**
    - **Validates: Requirements 2.5, 2.14–2.21**

  - [ ] 2.10 Write the property test for canonical catalog round trips
    - **Property 4: Canonical source catalogs round-trip semantically**
    - **Validates: Requirements 2.22–2.24, 14.9, 14.10**

- [ ] 3. Implement event normalization and bounded ingestion
  - [ ] 3.1 Implement event, occurrence, temporal, and validation value objects
    - Model exact date-only values separately from timezone-qualified instants; normalize title whitespace; preserve omitted fields as unknown; and retain source temporal values.
    - Treat invalid ingested end ordering as pending with a linked Validation_Error while rejecting invalid starts atomically.
    - _Requirements: 4.1–4.12_

  - [ ] 3.2 Implement canonical identity and atomic event/provenance upserts
    - Compute the versioned length-prefixed SHA-256 identity, retain stable event IDs, union distinct provenance, update same-identity values, and append each retrieval observation exactly once under replay/concurrency.
    - _Requirements: 3.9, 4.11–4.16, 9.3, 12.9_

  - [ ] 3.3 Implement retention settings and archive eligibility
    - Validate whole-day settings from 0 through 3650 while preserving preceding values on rejection, and implement a separate archival eligibility job without deleting or implicitly publishing records.
    - _Requirements: 4.17–4.19_

  - [ ] 3.4 Implement discovery URL selection and disjoint adapter registration
    - Select stable distinct URLs in catalog order, apply event-specific fallback rules, cap evaluation at 100 with exact omission counts, and select zero/one/many adapters without performing a content request for unsupported/conflict outcomes.
    - _Requirements: 3.1–3.8_

  - [ ] 3.5 Implement the safe source HTTP and automated-access policy layer
    - Upgrade HTTP discovery to same-authority HTTPS without fallback, require TLS 1.2+, revalidate DNS and redirects, block SSRF destinations, bound redirects/bytes/time/types/retries, and enforce robots/access prohibitions for the remainder of a source run.
    - _Requirements: 3.10–3.12, 3.16, 3.17, 13.2, 13.3_

  - [ ] 3.6 Implement structured public-web adapters and ordered page traversal
    - Parse bounded Schema.org JSON-LD, HTML JSON-LD, iCalendar, XML sitemap, and supported JSON without visual-text scraping; preserve source IDs/URLs/format/provenance and traverse pages in source order through validated limits.
    - _Requirements: 3.9–3.15, 4.10_

  - [ ] 3.7 Implement ingestion worker orchestration and review interfaces
    - Exclude disabled sources before attempted counts, reject same-source concurrency, claim/heartbeat jobs, isolate source outcomes, preserve prior records after failures, and persist balanced summaries.
    - Implement prepare/confirm/run-status interfaces with selected identities, states, counts, optimistic selection version, page-limit validation, and fixture-only deterministic ingestion.
    - _Requirements: 3.14, 3.18, 3.19, 5.1–5.6, 5.15–5.23, 12.7–12.9, 14.4, 14.8, 15.3, 15.4_

  - [ ] 3.8 Add normalization, adapter, and ingestion integration tests
    - Cover title/time boundaries, DST, transaction failure, identity concurrency, retention bounds, success/failure/unsupported/prohibited/conflict/secure-connection/URL-limit/page-limit/no-event/interruption outcomes, and zero live-source requests.
    - _Requirements: 3.1–3.19, 4.1–4.19, 5.3–5.6, 12.7–12.9, 14.1–14.4, 14.8_

  - [ ] 3.9 Write the property test for discovery URL selection
    - **Property 5: Discovery URL selection is stable, distinct, and bounded**
    - **Validates: Requirements 3.1, 3.4, 3.5, 3.6**

  - [ ] 3.10 Write the property test for adapter cardinality
    - **Property 6: Adapter cardinality controls all requests**
    - **Validates: Requirements 3.2, 3.3, 3.7, 3.8**

  - [ ] 3.11 Write the property test for retrieval outcomes
    - **Property 7: Retrieval outcomes cannot invent events**
    - **Validates: Requirements 3.9, 3.10, 3.11**

  - [ ] 3.12 Write the property test for page traversal
    - **Property 8: Discoverable page traversal is ordered and limit-exact**
    - **Validates: Requirements 3.13, 3.14, 3.15**

  - [ ] 3.13 Write the property test for access prohibitions
    - **Property 9: Automated-access prohibitions are fail-closed**
    - **Validates: Requirements 3.16, 3.17**

  - [ ] 3.14 Write the property test for event text normalization
    - **Property 10: Event text normalization is idempotent and non-fabricating**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.10**

  - [ ] 3.15 Write the property test for occurrence parsing
    - **Property 11: Occurrence parsing preserves temporal kind and meaning**
    - **Validates: Requirements 4.4–4.7**

  - [ ] 3.16 Write the property test for invalid end ordering
    - **Property 12: Invalid end ordering is retained for review, not published implicitly**
    - **Validates: Requirements 4.8, 4.9**

  - [ ] 3.17 Write the property test for deduplication and provenance union
    - **Property 13: Deduplication retains one event and all provenance**
    - **Validates: Requirements 4.13, 4.14, 14.11, 14.12**

  - [ ] 3.18 Write the property test for exact-once identity updates
    - **Property 14: Same-identity updates are exact-once observations**
    - **Validates: Requirements 4.15, 4.16**

  - [ ] 3.19 Write the property test for retention boundaries
    - **Property 15: Retention settings and archive eligibility honor inclusive bounds**
    - **Validates: Requirements 4.17–4.19**

  - [ ] 3.20 Write the property test for ingestion summaries
    - **Property 16: Ingestion summaries are nonnegative and balanced**
    - **Validates: Requirements 5.3, 5.4**

- [ ] 4. Implement public event discovery, API contracts, and accessible UI
  - [ ] 4.1 Implement published-upcoming queries and deterministic pagination
    - Capture one page-open instant, apply Delaware date rules and the complete ordering tuple, validate page/page-size values without changing preceding state, and return complete duplicate-free page metadata/navigation.
    - _Requirements: 6.1–6.17, 9.2–9.4, 9.17, 9.18_

  - [ ] 4.2 Implement search, filters, metadata, and URL-state codecs
    - Implement trimmed contiguous case-insensitive matching, AND-between/OR-within filters, combined ordering, canonical query encoding/decoding, unsupported-value tolerance, clear/reset behavior, and invalid-input preservation semantics.
    - _Requirements: 7.1–7.16_

  - [ ] 4.3 Implement public event detail and visibility projection
    - Project every known approved field and exact external URL, future occurrences, addresses/coordinates, ticket/registration/cost data, while omitting unknown values.
    - Make unknown and unpublished records byte-equivalent 404 responses with no moderation, status, provenance, or existence data.
    - _Requirements: 8.1–8.11, 9.9, 9.14–9.16_

  - [ ] 4.4 Expose versioned public routes and complete OpenAPI schemas
    - Implement event list/detail, search metadata, health, typed pagination links, field-specific 400s, identical hidden-record 404s, correlation-only 500s, and machine-readable purpose/auth/parameter/bound/response metadata.
    - _Requirements: 9.1–9.18_

  - [ ] 4.5 Implement accessible reusable UI primitives and navigation
    - Build semantic field/filter/status/external-link/pagination/dialog/table-card primitives with keyboard behavior, visible focus, error associations, live announcements, text alternatives, and 400% reflow support.
    - _Requirements: 8.9, 11.1–11.10, 18.1_

  - [ ] 4.6 Build event index, search/filter, detail, and no-results routes
    - Wire the generated client to URL restoration, one-second URL/result announcements, page navigation, clear controls, retained invalid input/preceding results, exact date-only rendering, external notices, and private-safe not-found UI.
    - _Requirements: 6.1–6.17, 7.6–7.16, 8.1–8.11, 11.7–11.10_

  - [ ] 4.7 Add public-query database, contract, browser, and accessibility tests
    - Cover Delaware dates, DST, ordering ties, snapshot coverage, all query/filter combinations, page bounds, stable IDs, repeated requests, OpenAPI responses, 404 equivalence, keyboard paths, live regions, and 400% reflow across supported browsers.
    - _Requirements: 6.1–6.17, 7.1–7.16, 8.1–8.11, 9.1–9.18, 11.1–11.10, 14.2, 14.5, 14.6_

  - [ ] 4.8 Write the property test for public event selection
    - **Property 20: Public event selection exposes exactly published upcoming occurrences**
    - **Validates: Requirements 6.1, 6.2**

  - [ ] 4.9 Write the property test for occurrence ordering
    - **Property 21: Public occurrence ordering is a deterministic total order**
    - **Validates: Requirements 6.3–6.5**

  - [ ] 4.10 Write the property test for pagination coverage
    - **Property 22: Collection pagination has complete, duplicate-free coverage**
    - **Validates: Requirements 6.6–6.9, 9.2, 18.3, 18.6, 18.8, 18.11, 18.16**

  - [ ] 4.11 Write the property test for contiguous search
    - **Property 23: Search normalization and contiguous matching agree with a reference model**
    - **Validates: Requirements 7.1, 7.2, 7.13**

  - [ ] 4.12 Write the property test for filter composition
    - **Property 24: Filter composition is AND between groups and OR within groups**
    - **Validates: Requirements 7.3–7.5**

  - [ ] 4.13 Write the property test for search URL state
    - **Property 25: Search URL state round-trips and tolerates unsupported values**
    - **Validates: Requirements 7.7–7.9**

  - [ ] 4.14 Write the property test for overlong searches
    - **Property 26: Overlong searches fail without replacing prior results**
    - **Validates: Requirements 7.11, 7.12**

  - [ ] 4.15 Write the property test for public detail projection
    - **Property 27: Public detail projection is complete but never fabricated**
    - **Validates: Requirements 8.1, 8.3–8.6, 8.10**

  - [ ] 4.16 Write the property test for detail occurrence filtering
    - **Property 28: Detail recurrence filtering uses each source timezone**
    - **Validates: Requirements 8.2**

  - [ ] 4.17 Write the property test for hidden event details
    - **Property 29: Unknown and unpublished event details are observationally indistinguishable**
    - **Validates: Requirements 8.7, 8.8**

  - [ ] 4.18 Write the property test for stable IDs and repeated queries
    - **Property 30: Stable event IDs and immutable queries are deterministic**
    - **Validates: Requirements 9.3, 9.4**

  - [ ] 4.19 Write the property test for invalid API parameters
    - **Property 31: Invalid API parameters are side-effect free**
    - **Validates: Requirements 9.5–9.8**

  - [ ] 4.20 Write the property test for unauthenticated projections
    - **Property 32: Unauthenticated projections are public-only**
    - **Validates: Requirements 9.14**

- [ ] 5. Implement authentication, ingestion controls, and moderation
  - [ ] 5.1 Implement credential isolation, sessions, and secure bootstrap
    - Implement Argon2id hashing, envelope-encrypted credential storage, opaque token digests, idle/absolute expiry, rotation/revocation, generic login failures, and secret-input bootstrap without command-line or source-controlled credentials.
    - _Requirements: 10.1, 10.2, 10.6–10.10, 13.7, 13.8_

  - [ ] 5.2 Implement RBAC and browser-request integrity
    - Add editor/contributor policies, synchronizer CSRF tokens bound to session/action, anonymous form sessions, Origin/Fetch Metadata checks, and authorization before protected lookup.
    - Return 401/403 as specified and perform no protected read or persisted mutation on failure.
    - _Requirements: 10.1–10.7, 13.4, 13.11_

  - [ ] 5.3 Implement event moderation transitions, corrections, and audits
    - Enforce the legal status graph, rejection-reason bounds, field-specific revisions, exactly one audit per successful action, idempotent replay, optimistic versions, and complete rollback if an audit/revision write fails.
    - _Requirements: 5.6–5.14, 5.18, 5.19, 5.23, 10.3–10.5, 10.10_

  - [ ] 5.4 Implement source-state and ingestion-control mutations
    - Persist enabled/disabled state with exact preceding/selected audit data, exclude disabled sources from runs/counts, confirm prepared selections, and reject concurrent runs without mutating source, event, run, provenance, or history state.
    - _Requirements: 5.1–5.5, 5.15–5.22_

  - [ ] 5.5 Build authentication and moderation API/UI routes
    - Implement login/logout/session, source/run/event queues, prepare/run/status, approve/reject/archive/correct/state endpoints, and accessible responsive moderation views with separate protected DTOs.
    - _Requirements: 5.1–5.23, 10.1–10.7, 11.1–11.8_

  - [ ] 5.6 Add auth/moderation unit, integration, contract, and browser tests
    - Test credential/session expiry, 401/403 behavior, every transition/reason boundary, exact audit/revision data, source-state effects, run conflicts, CSRF/origin denial, idempotency, transaction failure, and unchanged state after unauthorized requests.
    - _Requirements: 5.1–5.23, 10.1–10.10, 13.4, 13.11, 14.1–14.6_

  - [ ] 5.7 Write the property test for valid moderation transitions
    - **Property 17: Valid event moderation transitions are exact and audited**
    - **Validates: Requirements 5.6–5.10, 10.5**

  - [ ] 5.8 Write the property test for invalid moderation commands
    - **Property 18: Invalid moderation commands preserve the aggregate**
    - **Validates: Requirements 5.18, 5.19**

  - [ ] 5.9 Write the property test for source state behavior
    - **Property 19: Source state changes are audited and disabled sources are invisible to retrieval**
    - **Validates: Requirements 5.16, 5.17, 5.20, 5.21**

  - [ ] 5.10 Write the property test for unauthorized operations
    - **Property 33: Unauthorized protected operations disclose and mutate nothing**
    - **Validates: Requirements 10.4, 13.11**

  - [ ] 5.11 Write the property test for request-integrity failures
    - **Property 36: Invalid request-integrity evidence cannot mutate state**
    - **Validates: Requirements 13.4**

- [ ] 6. Implement public content and submission workflows
  - [ ] 6.1 Implement content models, repositories, and publication policies
    - Add regions, organization profiles/contributors, editorial features/links, podcast entries, arts opportunities, immutable slugs, attribution, rights notices, and deterministic public predicates/order/pagination.
    - _Requirements: 1.8–1.10, 18.2–18.29_

  - [ ] 6.2 Implement content APIs, moderation operations, and public routes
    - Add versioned region/feature/podcast/opportunity/organization endpoints and editor transitions using the shared audit/idempotency layer.
    - Build accessible home/content/moderation routes with stable URLs, exact external links, no-results privacy, and full page navigation.
    - _Requirements: 10.5, 11.1–11.10, 18.1–18.29_

  - [ ] 6.3 Implement immutable submission persistence and contributor links
    - Add base/per-kind tables, ordered unique occurrences, encrypted source address, consent/terms/time metadata, eligibility state, approved-target uniqueness, contributor/profile links, and append-only payload/history repositories.
    - _Requirements: 19.7–19.10, 19.14, 19.17, 19.19, 19.21, 19.25, 19.29, 19.30, 19.36–19.38_

  - [ ] 6.4 Implement submission validation, text safety, and eligibility policies
    - Accumulate every exact field/contact/URL/count error before persistence; reject executable payloads and disallowed schemes atomically while preserving accepted literal text.
    - Implement occurrence validation, contributor authorization, Delaware-boundary distance, attendance restrictions, and manual eligibility when coordinates cannot be established.
    - _Requirements: 13.1, 19.1–19.6, 19.11–19.15, 19.22–19.24, 19.27–19.45_

  - [ ] 6.5 Implement submission intake, approval, and correction workflows
    - Implement organization, contributor event, public change-request, and opportunity intake/approval with field masks, exact target links, idempotency, revisions, audits, and all-or-nothing failure behavior.
    - _Requirements: 19.7–19.10, 19.16–19.21, 19.25, 19.26, 19.37, 19.38, 19.42_

  - [ ] 6.6 Build submission APIs, forms, and moderation queues
    - Add form-session bootstrapping and versioned endpoints for each kind, then build semantic forms/queues with field summaries, safe retained values, keyboard support, live status, and responsive layouts.
    - _Requirements: 9.5, 10.1–10.7, 11.1–11.10, 19.1–19.45_

  - [ ] 6.7 Add content/submission database, contract, E2E, and accessibility tests
    - Cover stable slugs, publication/order/deadline/region filters, page coverage, privacy, every input boundary/scheme/contact/eligibility outcome, approval masks, transaction failures, successful critical journeys, keyboard operation, and 400% reflow.
    - _Requirements: 11.1–11.10, 14.1–14.6, 18.1–18.29, 19.1–19.45_

  - [ ] 6.8 Write the property test for regional discovery
    - **Property 44: Region discovery returns only published qualifying events**
    - **Validates: Requirements 18.2**

  - [ ] 6.9 Write the property test for editorial feature links
    - **Property 45: Editorial features cannot expose non-published linked events**
    - **Validates: Requirements 18.5**

  - [ ] 6.10 Write the property test for podcast ordering
    - **Property 46: Podcast indexes are published-only and newest-first**
    - **Validates: Requirements 18.7, 18.20**

  - [ ] 6.11 Write the property test for current opportunities
    - **Property 47: Current opportunity selection has an inclusive Delaware deadline**
    - **Validates: Requirements 18.10, 18.12, 18.13, 18.21**

  - [ ] 6.12 Write the property test for organization public views
    - **Property 48: Organization public views expose only associated future published events**
    - **Validates: Requirements 18.15, 18.17, 18.22**

  - [ ] 6.13 Write the property test for organization submissions
    - **Property 49: Organization submission workflow is complete and idempotent**
    - **Validates: Requirements 19.1–19.9**

  - [ ] 6.14 Write the property test for contributor event eligibility
    - **Property 50: Contributor event intake enforces linkage and public eligibility**
    - **Validates: Requirements 19.10–19.13, 19.37, 19.40**

  - [ ] 6.15 Write the property test for submitted occurrences
    - **Property 51: Event-submission occurrences are bounded, ordered, and valid**
    - **Validates: Requirements 19.14, 19.15, 19.34, 19.41**

  - [ ] 6.16 Write the property test for event/correction approvals
    - **Property 52: Approved event and correction changes are selective, historical, and audited**
    - **Validates: Requirements 19.16–19.21, 19.38, 19.42**

  - [ ] 6.17 Write the property test for opportunity submissions
    - **Property 53: Opportunity submissions obey content, timing, and lifecycle bounds**
    - **Validates: Requirements 19.22–19.26, 19.35**

  - [ ] 6.18 Write the property test for unsafe submissions
    - **Property 54: Unsafe submission payloads and schemes are atomically rejected**
    - **Validates: Requirements 19.27, 19.28**

  - [ ] 6.19 Write the property test for submission metadata
    - **Property 55: Accepted submissions record required trustworthy metadata**
    - **Validates: Requirements 19.29, 19.30, 19.36**

  - [ ] 6.20 Write the property test for event/correction text bounds
    - **Property 56: Event and correction text bounds are exact**
    - **Validates: Requirements 19.31–19.33, 19.43–19.45**

- [ ] 7. Implement security, observability, reliability, and recovery
  - [ ] 7.1 Implement structured logs, metrics, correlation, and recursive redaction
    - Emit bounded request/source-run JSON records within required intervals and expose protected request, latency, error, ingestion, freshness, published-count, job, and alert metrics without high-cardinality or secret data.
    - _Requirements: 9.10, 9.11, 13.7, 15.1–15.6_

  - [ ] 7.2 Implement transport defenses and rolling public rate limits
    - Configure TLS 1.2+, HSTS/CSP/security headers, secure cookies, literal rendering, parameterized persistence, and an attributed rolling 60-request/60-second limiter with integer `Retry-After` from 1 through 60.
    - _Requirements: 13.1–13.7_

  - [ ] 7.3 Implement freshness and durable alert/outbox state machines
    - Validate freshness settings, update stale-source state, evaluate/deduplicate/recover error-rate and consecutive-failure alerts, and retain/retry failed deliveries at specified intervals and limits.
    - _Requirements: 15.7–15.18_

  - [ ] 7.4 Implement public caching, dependency health, and interruption recovery
    - Add bounded revision-keyed caches, readiness failure within five seconds of database loss, dependency-independent liveness, failed lease recovery, and idempotent unchanged-data retries.
    - _Requirements: 12.7–12.11_

  - [ ] 7.5 Implement verified backup/restore and release records
    - Add terminating PostgreSQL backup/empty-environment restore commands with schema, count, identifier, status, field, provenance, and moderation-relationship manifests.
    - Store immutable release health evidence needed by deployment rollback selection without mutating application records during selection.
    - _Requirements: 12.12, 12.13, 16.89–16.93_

  - [ ] 7.6 Implement deterministic performance and security validation code
    - Generate exactly 100,000 test events and one-shot k6 scenarios for all specified rates/durations/thresholds, with a shorter smoke profile.
    - Add SAST, secret, exact-lockfile dependency, container, CSRF/session/SSRF/header/unsafe-payload checks that fail nonzero on critical findings or incomplete scans.
    - _Requirements: 12.1–12.6, 13.1–13.11, 14.13_

  - [ ] 7.7 Add operations, security, reliability, backup, and performance tests
    - Verify log timing/shape/redaction, metric freshness, alert transitions/retries, cache invalidation, database outage behavior, interruption recovery, backup/restore equality, scanner failure behavior, and required load thresholds.
    - _Requirements: 12.1–12.13, 13.1–13.11, 14.13, 15.1–15.18_

  - [ ] 7.8 Write the property test for unchanged-source idempotency
    - **Property 34: Re-ingesting unchanged source data is idempotent**
    - **Validates: Requirements 12.9**

  - [ ] 7.9 Write the property test for literal user text
    - **Property 35: Accepted user text remains literal data**
    - **Validates: Requirements 13.1**

  - [ ] 7.10 Write the property test for rolling rate limits
    - **Property 37: Public rate limiting is rolling-window exact and bounded**
    - **Validates: Requirements 13.5, 13.6**

  - [ ] 7.11 Write the property test for log redaction
    - **Property 38: Operational-log serialization redacts sensitive values**
    - **Validates: Requirements 13.7**

  - [ ] 7.12 Write the property test for freshness state
    - **Property 39: Freshness configuration and stale-state transitions are boundary-correct**
    - **Validates: Requirements 15.7–15.10**

  - [ ] 7.13 Write the property test for request-error alerts
    - **Property 40: Request-error alerts have threshold hysteresis and deduplication**
    - **Validates: Requirements 15.11–15.13**

  - [ ] 7.14 Write the property test for source-failure alerts
    - **Property 41: Consecutive source-failure alerts reset only on success**
    - **Validates: Requirements 15.14–15.16**

  - [ ] 7.15 Write the property test for alert retries
    - **Property 42: Alert delivery failures remain visible and retry finitely**
    - **Validates: Requirements 15.17, 15.18**

  - [ ] 7.16 Write the property test for rollback eligibility
    - **Property 43: Rollback selects only the immediately preceding eligible release**
    - **Validates: Requirements 16.89–16.93**

- [ ] 8. Package and validate the complete local release
  - [ ] 8.1 Implement deterministic setup, migration, seed, import, and demo commands
    - Wire local database migration, all-catalog import, secret-safe account bootstrap, fixture ingestion, and content seeds into idempotent terminating commands incapable of contacting live event sources.
    - _Requirements: 2.1–2.24, 10.8, 10.9, 14.8, 17.1–17.4_

  - [ ] 8.2 Create the hardened multi-stage OCI image and Compose stack
    - Build web/worker/migration artifacts from the exact lockfile, run as a numeric non-root user with read-only-root compatibility, and bind version/source revision without secrets.
    - Define TLS-enabled PostgreSQL, web, worker, migration tooling, health dependencies, Docker secrets, persistent data, and explicitly local fixture profiles.
    - _Requirements: 10.8, 10.9, 12.10, 12.11, 13.2, 13.3, 16.8, 16.9, 16.41, 16.51, 16.70_

  - [ ] 8.3 Complete OpenAPI and generated-client contract enumeration
    - Generate every public/auth/submission/moderation/content/health operation and automatically exercise each documented success/error response, authentication rule, bound, and runtime response.
    - _Requirements: 9.1–9.18, 14.5_

  - [ ] 8.4 Complete deterministic E2E and accessibility suites
    - Cover every Critical_User_Journey, privacy/no-results/role/CSRF/error-retention behavior, full keyboard operation, focus/live regions, axe checks, and 400% reflow across required routes and browsers.
    - _Requirements: 11.1–11.10, 14.6–14.8, 18.1–18.29, 19.1–19.45_

  - [ ] 8.5 Implement requirements/test/clean-room coverage gates
    - Generate a machine-readable map from every acceptance criterion and correctness property to executable evidence and fail on missing mappings, missing referenced tests, duplicate property implementations, fewer than 100 runs, missing journeys, or live-source requests.
    - _Requirements: 1.1–1.10, 14.1–14.13, 17.10, 17.11_

  - [ ] 8.6 Implement typed handoff and adapter-readiness generators
    - Generate setup/config/import/moderation/backup/restore/release procedure artifacts and adapter metadata from closed schemas containing prerequisites, inputs, actions, success/recovery indicators, dependency effects, formats, URLs, limits, frequencies, timeouts, retries, and failure outcomes.
    - _Requirements: 17.1–17.7_

  - [ ] 8.7 Implement the terminating application release-validation orchestrator
    - Compose typecheck, lint, unit/property, database, ingestion, contract, E2E, accessibility, security, performance evidence, backup/restore, clean-room, image, and later infrastructure checks into one non-watch command with structured evidence and nonzero failure.
    - _Requirements: 13.9, 13.10, 14.1–14.13, 17.1–17.11_

- [ ] 9. Implement pinned CDK v2 configuration and AWS identity guards
  - [ ] 9.1 Create the pinned AWS CDK v2 application and deterministic assembly
    - Add exact `aws-cdk-lib`, `constructs`, CDK CLI, AWS SDK v3, assertion, and cdk-nag versions under `infra/cdk`; use explicit environments and context-free imports rather than account lookups.
    - Define stable environment-qualified stack/construct IDs and an explicit Registry → Foundation → Data → Compute → Service dependency graph.
    - _Requirements: 16.1, 16.2, 16.28, 16.42, 16.54–16.61_

  - [ ] 9.2 Implement typed Environment_Configuration and Deployment_Input validation
    - Define a closed TypeBox schema for environment, exact account/Region, release/source/image identity, DNS/certificate mode, networking, task/database/backup capacity, retention/protection/log/alert settings, budget, and cost assumptions.
    - Reject missing/invalid inputs before synthesis or mutation; enforce release length, account format, DNS-mode completeness, autoscaling ordering, database connection allowance, and production protection rules.
    - _Requirements: 16.5–16.15, 16.74, 16.75, 16.94–16.97_

  - [ ] 9.3 Implement default credential-chain caller-identity and Region preflight
    - Use AWS SDK v3 default credential and Region providers without profile/static-credential overrides; resolve STS caller identity and active Region before bootstrap, image publication, migration, deploy, rollback, or destroy.
    - Emit principal/account/Region/environment/action review data and fail before mutation on missing/expired/root credentials, missing Region, or expected account/Region mismatch.
    - _Requirements: 16.16–16.23_

  - [ ] 9.4 Implement reusable Cloud_Mutation authorization boundaries
    - Route every mutating AWS adapter through a command gate requiring a supported action, successful fresh preflight, explicit stack/resource scope, and a valid Sealed_Deployment_Plan authorization.
    - Provide dry-run/fake adapters that record intended calls and prove specification, validation, and planning paths cannot invoke mutations.
    - _Requirements: 16.3, 16.4, 16.17–16.23, 16.47, 16.48, 16.56_

  - [ ] 9.5 Implement CDK bootstrap inspection and guarded execution
    - Read the bootstrap version, render/normalize proposed bootstrap templates when absent/outdated, and extract IAM, asset, trust, permissions-boundary, and cost-bearing changes into the Deployment_Plan.
    - Permit bootstrap only as an explicitly sealed action and force a new identity/Region preflight before any later Cloud_Mutation.
    - _Requirements: 16.24–16.27_

  - [ ] 9.6 Add environment, preflight, gate, and bootstrap tests
    - Test every missing/boundary input, credential/Region/account/root/expiry mismatch, absent/outdated bootstrap, altered bootstrap template, unauthorized action, stale preflight, fake mutation ledger, and post-bootstrap re-preflight requirement.
    - _Requirements: 16.5–16.27, 16.39, 16.48_

- [ ] 10. Implement the five protected AWS deployment stacks
  - [ ] 10.1 Implement the Registry_Deployment_Stack
    - Define a private encrypted ECR repository with immutable tags, scan configuration, retained removal behavior, release/rollback-aware lifecycle controls, and repository policy; expose identifiers without Secret_Values.
    - _Requirements: 16.49–16.53, 16.57, 16.70, 16.79_

  - [ ] 10.2 Implement the Foundation_Deployment_Stack
    - Define a multi-AZ VPC with public ALB subnets, private application subnets without public task IPs, isolated data subnets, explicit NAT strategy, routing, endpoints, and base ALB/web/worker/migration/database security groups.
    - Restrict worker egress to reviewed DNS/HTTPS/protocol needs and encode NAT/endpoint cost/availability choices as validated inputs.
    - _Requirements: 16.11, 16.14, 16.31, 16.32, 16.58, 16.62–16.64, 16.67, 16.94–16.97_

  - [ ] 10.3 Implement the Data_Deployment_Stack
    - Define RDS PostgreSQL in isolated subnets with encryption, TLS-required parameters, Multi-AZ/capacity/storage inputs, backups/PITR, deletion protection, retained replacement/deletion policies, and Data stack termination protection.
    - Define separate least-privilege migration/runtime Secrets Manager resources, retained backup artifacts, alarms, and no secret-valued outputs.
    - _Requirements: 16.34, 16.35, 16.59, 16.67–16.70, 16.72, 16.76–16.80_

  - [ ] 10.4 Implement the Compute_Deployment_Stack
    - Define ECS cluster, digest-pinned web/worker/migration task definitions, separate execution/application roles, non-root/read-only-compatible runtime settings, exact secret references, distinct log groups/streams, ALB target groups/listeners, and migration command/time constraints.
    - Configure HTTPS with an approved ACM certificate, TLS 1.2+ policy, healthy readiness targets, and external-DNS certificate-validation outputs where selected.
    - _Requirements: 16.30, 16.33, 16.35, 16.51, 16.60, 16.64, 16.66, 16.68–16.71, 16.83_

  - [ ] 10.5 Implement the Service_Deployment_Stack
    - Define separate web/worker Fargate services, ALB-only web ingress, zero worker ingress, private task networking, circuit-breaker deployment behavior, desired/min/max autoscaling and database-connection bounds, deployment alarms, and managed/external DNS behavior.
    - _Requirements: 16.31, 16.54–16.56, 16.61–16.66, 16.72–16.75_

  - [ ] 10.6 Implement CloudWatch observability infrastructure
    - Create retained, finite-retention web/worker/migration log groups; dashboards; ALB/ECS/RDS/application/ingestion/backlog metrics and alarms; and reviewed alert-destination actions without high-cardinality or secret fields.
    - _Requirements: 16.12, 16.34, 16.35, 16.59–16.61, 16.71–16.73, 16.79_

  - [ ] 10.7 Add CDK assertions for stack resources, boundaries, and protections
    - Assert stable stack dependencies, exact resource ownership, digest image references, no public task/RDS exposure, ALB-only web ingress, zero worker ingress, TLS listener/certificate, isolated RDS, secret references, retention/update-replacement/deletion/termination protections, log/alarms, and no EKS/lookups.
    - _Requirements: 16.1, 16.2, 16.30–16.35, 16.51, 16.54–16.80_

  - [ ] 10.8 Add synthesized-template policy and security validation
    - Run cdk-nag and custom rules for role separation/least privilege, private ENIs, public-RDS denial, TLS, secret absence, stateful protection, image digests, autoscaling/connection bounds, approved alert routing, and explicit output allowlists.
    - Fail synthesis validation on any policy/security finding and accumulate independently detectable errors.
    - _Requirements: 16.28–16.39, 16.62–16.80_

  - [ ] 10.9 Implement Cost_Resource_Inventory generation
    - Normalize synthesized ECS, ALB, egress, RDS, ECR, Secrets Manager, CloudWatch, DNS/certificate, storage, key, and alert resources into quantities, billing bases, assumptions, estimates, maximum task/database boundaries, and unresolved values.
    - _Requirements: 16.44, 16.94–16.97, 17.8, 17.9_

- [ ] 11. Implement immutable release publication and sealed deployment planning
  - [ ] 11.1 Implement strict synthesis and normalized infrastructure manifests
    - Produce deterministic cloud assemblies/template digests for one validated environment and explicit stack list; run strict TypeScript/CDK synthesis and policy/security validation before any application-resource mutation.
    - _Requirements: 16.28–16.39, 16.42_

  - [ ] 11.2 Implement read-only change-set diff generation and normalization
    - Generate an accurate reviewed-account/Region change-set diff adapter, normalize additions/modifications/deletions/replacements/IAM/network/stateful impacts, digest the result, and execute none of the proposed application changes.
    - Reject diff errors and any Stateful_Resource deletion/replacement before deployment authorization.
    - _Requirements: 16.36–16.39, 16.42, 16.46, 16.80_

  - [ ] 11.3 Implement immutable ECR image publication and scan evidence
    - Build/push only through the guarded publication action, verify immutable release tags, resolve the accepted `sha256` digest, poll bounded scan completion for at most 30 minutes, and bind scan/release/source/lockfile/migration evidence.
    - Reject incomplete or policy-violating scans before service updates and retain current/rollback-eligible images.
    - _Requirements: 16.41, 16.49–16.53_

  - [ ] 11.4 Implement Deployment_Plan creation
    - Bind caller identity, Environment_Configuration digest, release/source/image/validation evidence, template/diff digests, explicit ordered stacks, migration/rollback actions, bootstrap action when needed, resource inventory, and cost assumptions into a deterministic plan.
    - _Requirements: 16.25, 16.40–16.44, 16.50, 16.54, 16.94–16.97_

  - [ ] 11.5 Implement Sealed_Deployment_Plan signing, expiry, and invalidation
    - Record approver reference, approval timestamp, 1–24 hour expiry, single-use state, and canonical integrity digest; validate all bound identity/input/artifact/template/diff/action/order/expiry fields immediately before mutation.
    - Invalidate on expiry or any mismatch and require no redundant approval during unchanged autonomous continuation.
    - _Requirements: 16.45–16.48_

  - [ ] 11.6 Add planning, diff, image, cost, and sealing tests
    - Use fake AWS adapters to test deterministic digests, exact diff categories, read-only planning, stateful replacement blocking, immutable tag/digest enforcement, scan timeout/finding failure, unresolved cost values, expiry boundaries, tampering, identity/input/artifact drift, single use, and zero unplanned mutations.
    - _Requirements: 16.36–16.53, 16.80, 16.94–16.97_

- [ ] 12. Implement guarded ordered deployment, verification, rollback, and decommission
  - [ ] 12.1 Implement the ordered Deployment_Automation state machine
    - Execute only actions and explicit stack instances in a valid sealed plan in Registry → Foundation → Data → Compute → Migration → Service order, persisting last-completed action and evidence after each step.
    - Stop with zero further Cloud_Mutations on any guard, validation, migration, deployment, or health failure.
    - _Requirements: 16.47, 16.48, 16.54–16.56_

  - [ ] 12.2 Implement stack deployment adapters and bounded waiters
    - Add explicit noninteractive CDK/CloudFormation adapters with stack-scoped arguments, caller/Region revalidation, bounded waits, structured events, no `--all`, no hidden bootstrap, and no direct unguarded deploy entry point.
    - _Requirements: 16.17–16.27, 16.47, 16.48, 16.54–16.56_

  - [ ] 12.3 Implement the one-off backward-compatible Migration_Task workflow
    - Require migration classification/evidence, execute only the approved digest-pinned task after Compute succeeds, enforce a 30-minute timeout, stop on nonzero/schema-verification failure, preserve the current Service revision, and record successful identifier/status/schema evidence.
    - _Requirements: 16.43, 16.54, 16.81–16.85_

  - [ ] 12.4 Implement bounded Post_Deployment_Verification
    - Start within 60 seconds and finish within 10 minutes with terminal evidence for CloudFormation completion, ECS steady state, ALB targets, readiness, database connectivity, log delivery, alarms, DNS mode, and TLS; mark unhealthy/incomplete on any missing condition.
    - _Requirements: 16.86–16.88_

  - [ ] 12.5 Implement guarded application rollback
    - Select only the immediately preceding Proven_Healthy_Release with an available ECR digest, generate/validate a fresh sealed rollback plan, and update only ECS service task-definition revisions.
    - Perform no automatic database restore/reverse migration and preserve release/data state when no eligible image exists.
    - _Requirements: 16.89–16.93_

  - [ ] 12.6 Implement drift detection and fail-closed reconciliation reporting
    - Add a read-only scheduled/on-demand drift adapter that normalizes stack/resource drift, correlates it to the sealed plan and stateful inventory, and reports without automatic reconciliation or Cloud_Mutation.
    - _Requirements: 16.36–16.39, 16.46, 16.48, 16.80, 17.8, 17.9_

  - [ ] 12.7 Implement guarded destroy and decommission safeguards
    - Deny destroy for protected environments by default; require a separately sealed decommission action naming every stack, retained/orphaned stateful resource, backup/snapshot disposition, DNS effect, and cost-bearing remainder.
    - Re-run identity/Region preflight and block any unlisted deletion, replacement, force-delete, bootstrap-stack destruction, automatic database restore, or reverse migration.
    - _Requirements: 16.17–16.23, 16.46, 16.76–16.80, 16.92, 16.94–16.97, 17.8, 17.9_

  - [ ] 12.8 Add fail-closed deployment state-machine tests
    - Test every ordering edge, explicit stack allowlist, stale/tampered/expired plan, preflight drift, deployment failure, waiter timeout, unexpected stack event, last-action recording, and proof that no later mutation runs after failure.
    - _Requirements: 16.40–16.48, 16.54–16.56_

  - [ ] 12.9 Add migration, verification, rollback, drift, and decommission tests
    - Test migration compatibility/timeout/exit/schema failures, verification timing and each evidence failure, healthy-release duration/digest eligibility, ECS-only rollback, no database reversal, drift read-only behavior, protected destroy denial, retained-resource inventory, and bootstrap protection.
    - _Requirements: 16.76–16.93, 16.94–16.97_

  - [ ] 12.10 Implement the final guarded release-validation and execution entry points
    - Provide separate terminating `validate`, `plan`, `seal`, `execute`, `rollback`, `drift`, and `decommission-plan` commands that share typed contracts and emit machine-readable evidence; only `execute`/`rollback`/sealed decommission may reach mutation adapters.
    - Extend release validation to run application tests, CDK assertions/nag/security checks, synthetic planning, fake-adapter no-mutation tests, migration dry runs against disposable PostgreSQL, container scans, backup/restore evidence, and task/requirements coverage.
    - _Requirements: 13.9, 13.10, 14.1–14.13, 16.3–16.97, 17.1–17.11_

## Notes

- All implementation uses TypeScript on Node.js 22, including AWS CDK v2 infrastructure and guarded deployment automation.
- All test tasks are required because Requirements 14 and 16 make deterministic validation and fail-closed deployment behavior part of the delivered system.
- Each correctness-property task must contain exactly one top-level `fc.assert`, use the design's feature/property comment format, run at least 100 generated cases, and record replayable seed/path data.
- Automated application tests use fixed local fixtures and make zero requests to live third-party event sources. AWS planning/deployment tests use fake or recorded adapters and must prove no Cloud_Mutation occurs on validation, planning, denial, or failure paths.
- Implemented deployment commands remain inert unless explicitly invoked later with reviewed inputs and a valid Sealed_Deployment_Plan. Creating this task document performs no AWS command or Cloud_Mutation.
- Every stack deployment is explicit and ordered; direct `cdk deploy --all`, hidden bootstrap, mutable image tags, automatic database reversal, automatic drift reconciliation, and unguarded destroy are unsupported.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.4", "1.5"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["1.6", "2.2", "2.3"] },
    { "id": 4, "tasks": ["2.4"] },
    { "id": 5, "tasks": ["2.5"] },
    { "id": 6, "tasks": ["2.6", "2.7", "2.8", "2.9", "2.10"] },
    { "id": 7, "tasks": ["3.1", "3.4"] },
    { "id": 8, "tasks": ["3.2", "3.3", "3.5", "3.6"] },
    { "id": 9, "tasks": ["3.7"] },
    { "id": 10, "tasks": ["3.8", "3.9", "3.10", "3.11", "3.12", "3.13", "3.14", "3.15", "3.16", "3.17", "3.18", "3.19", "3.20"] },
    { "id": 11, "tasks": ["4.1", "4.2", "4.3"] },
    { "id": 12, "tasks": ["4.4", "4.5"] },
    { "id": 13, "tasks": ["4.6"] },
    { "id": 14, "tasks": ["4.7", "4.8", "4.9", "4.10", "4.11", "4.12", "4.13", "4.14", "4.15", "4.16", "4.17", "4.18", "4.19", "4.20"] },
    { "id": 15, "tasks": ["5.1"] },
    { "id": 16, "tasks": ["5.2", "5.3", "5.4"] },
    { "id": 17, "tasks": ["5.5"] },
    { "id": 18, "tasks": ["5.6", "5.7", "5.8", "5.9", "5.10", "5.11"] },
    { "id": 19, "tasks": ["6.1", "6.3"] },
    { "id": 20, "tasks": ["6.2", "6.4"] },
    { "id": 21, "tasks": ["6.5"] },
    { "id": 22, "tasks": ["6.6"] },
    { "id": 23, "tasks": ["6.7", "6.8", "6.9", "6.10", "6.11", "6.12", "6.13", "6.14", "6.15", "6.16", "6.17", "6.18", "6.19", "6.20"] },
    { "id": 24, "tasks": ["7.1", "7.2", "7.3", "7.4"] },
    { "id": 25, "tasks": ["7.5", "7.6"] },
    { "id": 26, "tasks": ["7.7", "7.8", "7.9", "7.10", "7.11", "7.12", "7.13", "7.14", "7.15", "7.16"] },
    { "id": 27, "tasks": ["8.1", "8.2", "8.3", "8.5", "8.6"] },
    { "id": 28, "tasks": ["8.4"] },
    { "id": 29, "tasks": ["8.7"] },
    { "id": 30, "tasks": ["9.1", "9.2"] },
    { "id": 31, "tasks": ["9.3", "10.1", "10.2"] },
    { "id": 32, "tasks": ["9.4", "9.5", "10.3"] },
    { "id": 33, "tasks": ["9.6", "10.4"] },
    { "id": 34, "tasks": ["10.5", "10.6"] },
    { "id": 35, "tasks": ["10.7", "10.8", "10.9"] },
    { "id": 36, "tasks": ["11.1"] },
    { "id": 37, "tasks": ["11.2", "11.3"] },
    { "id": 38, "tasks": ["11.4"] },
    { "id": 39, "tasks": ["11.5"] },
    { "id": 40, "tasks": ["11.6"] },
    { "id": 41, "tasks": ["12.1", "12.2"] },
    { "id": 42, "tasks": ["12.3"] },
    { "id": 43, "tasks": ["12.4"] },
    { "id": 44, "tasks": ["12.5", "12.6", "12.7"] },
    { "id": 45, "tasks": ["12.8", "12.9"] },
    { "id": 46, "tasks": ["12.10"] }
  ]
}
```

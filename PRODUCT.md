# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user, confirmed for this redesign: a regional analyst who reviews new housing advertisements, checks suggested links to residential complexes, verifies evidence, and decides whether a risk factor can be confirmed. Legal reviewers and regional managers are adjacent audiences described in the supplied pilot brief, but the local prototype supports account roles after an administrator is created; production deployment is not established.

## Product Purpose

SAQ QURYLYS helps an analyst organize source-backed signals about risks associated with residential construction. Success means the analyst can move from a saved publication to a verified complex link, inspect the exact evidence behind a proposed factor, make the decision themselves, and retain an auditable signal snapshot.

## Positioning

The product keeps machine suggestions, verified source evidence, confirmed risk factors, and deterministic scoring distinct. An AI hypothesis alone does not add points, and the interface does not issue a legal verdict.

## Operating Context

The main workflow is: save advertisement text → inspect extracted facts and exact quotations → review candidate complex matches → confirm a match manually → review each proposed risk factor → create a signal with its source and history. Analysts use the existing web interface in Russian or Kazakh. The current server and SQLite database run locally for demonstrations.

## Capabilities and Constraints

- Authenticated writes revalidate the actor/session after acquiring the SQLite writer lock. Concurrent revocation cannot be bypassed by waiting on an old WAL snapshot; settings/factor/signal checks also read their current state under the lock. Two-process HTTP regressions cover this boundary; it is not a claim of industrial load certification.

- MIO can capture, verify, reject, resolve and reverify citizen complaints in the object card. Only confirmed collective receipts activate their linked R4; multiple receipts count the factor code once. Intake and decisions are immutable, frozen in new signals and preserved by backup recovery. External citizen-service integration is absent; source authenticity and individual complaint significance remain human review tasks.

- A verified permit alone does not grant green. MIO records dated, source-backed checks of document/object identity, active construction, unresolved significant complaints and delay. Decisions are immutable and bound to the object context; the app applies an explicit 30-calendar-day review window, separate from permit validity. Risk factors still override green. These are human assertions, not automatic registry verification; historical signals stay frozen.

- The signals inbox supports recipient/status/response filters, literal Unicode search, deadline ordering, scoped counters and cursor pagination. Lists omit complete evidence; individual cards retain it. Assigned materials require the recipient response before archiving; earlier archived history remains unchanged. This is an internal workflow, without external delivery.

- Public-mode configuration enforces a fixed HTTPS origin, explicit immediate proxy, secure sessions and an active local ADMIN before startup. Consistent SQLite backup and verified recovery to a new file are available; restored accounts/sources are disabled, sessions cleared and active jobs cancelled for operator review. Local TLS browser QA and recovery checks passed; public hosting, trusted certificates and operational backup rotation remain unverified.

- The current MVP has five connected areas: overview, residential-complex registry, advertisement monitoring, signals, and history.
- The hackathon scoring model is R1 +35, R2 +25, R3 +10, R4 +15, R5 +10, R6 +5. Only confirmed factors score; unknowns and AI hypotheses score zero and remain review items. Zones are 0–24 green, 25–59 yellow, and 60+ red only when both R1 and R2 are confirmed. Historical signal snapshots are preserved.
- URLs entered in the manual advertisement form remain references. Administrators can separately configure HTTPS HTML/JSON sources with a persistent collection/analysis queue and immutable raw archives. Source and queue management are available in Settings; native social APIs remain unavailable. Manual PNG/JPEG evidence is immutable and embedded into new signal exports.
- The default hackathon seed contains 10 synthetic residential complexes and 16 synthetic advertisements, exceeding the case minimum of 8 and 12. A separate optional 48-record pilot fixture is also synthetic; neither set represents verified public registry data.
- Government registry integrations and production deployment are simulated via truthful local records and CSV import. Local accounts, enforced roles (MIO, GASK, Law Enforcement, Admin), employee lifecycle, mandatory temporary-password changes, internal assignments, versioned workday calendars, persistent recalculation, and the Google Material 3 interactive coordinate map are implemented.
- New signals are internal review records with a frozen evidence snapshot. The application does not send them to agencies or imply an external response.
- Construction photos, human-entered measurements, MIO review, immutable readiness history and frozen signal photo exports are available. The system does not infer physical readiness from image pixels or authenticate capture time. Unknown publication dates stay explicitly unknown; observation dates are labeled separately.
- An optional OpenAI adapter exists; the default local classifier (`local-ml`) runs deterministically offline without keys.
- The detailed DOCX describes a separate future pilot. Its 48 real passports, government integrations, operational data, and rollout are not required for the current hackathon MVP and are not claimed as complete.

## Evidence on Hand

The source of product requirements is the supplied `Техническое задание — SAQ.docx`, `Кейс Codemasters 8.0. SAQ.pdf`, and the pasted product brief. Implementation evidence is in `src/`, `public/`, and `docs/`. The included dataset is synthetic; no real company evidence, user interviews, external integrations, or measured model performance are available for design claims.

## Product Principles

- Show the original source and exact quotation before a conclusion.
- Keep hypotheses, unknowns, human-confirmed factors, and calculated scores visibly distinct.
- Let an analyst make and audit consequential decisions.
- Make missing or unavailable data explicit instead of treating it as a negative finding.
- Label demonstrations as synthetic and never imply a live public-sector integration.

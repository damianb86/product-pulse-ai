# Acceptance Criteria

## AC-001 Embedded App
Given the merchant opens the app inside Shopify Admin, when authentication succeeds, then the app renders an embedded shell with ProductPulse AI navigation and no exposed tokens.

## AC-002 Connect Sources Empty State
Given no optional source is connected, when the merchant opens Connect sources, then the app shows Product data as available, optional sources as missing and a low coverage score with next steps.

## AC-003 Coverage Score
Given multiple sources are connected, when source weights are evaluated, then the score is deterministic and matches the connected-source contribution.

## AC-004 Catalog Scan
Given the merchant has product data access, when they click Run Catalog Scan, then a scan job is created or displayed and Dashboard reflects scan status.

## AC-005 Running Jobs
Given jobs are running or completed, when the merchant opens Running jobs, then each job shows status, progress, source, last update and any recoverable error.

## AC-006 Dashboard Start Here
Given products have risk snapshots, when Dashboard loads, then the highest priority product is shown with reason, risk, confidence and recommended next action.

## AC-007 Products Filtering
Given the merchant searches or filters Products, when the filter is applied, then only matching products remain visible and the empty state appears if no products match.

## AC-008 Diagnosis Credits
Given the merchant has at least one diagnosis credit, when they start Product Diagnosis, then one diagnosis credit is reserved/consumed for the selected product.

## AC-009 Insufficient Diagnosis Credits
Given the merchant has zero diagnosis credits, when they start Product Diagnosis, then the app blocks the action and shows a validation message without creating a diagnosis.

## AC-010 Diagnosis Evidence
Given a diagnosis exists, when the Product Diagnosis screen loads, then it shows likely cause, evidence by source, risk score, confidence, impact and issues.

## AC-011 Apply Draft Action
Given a diagnosis recommends a product action, when the merchant applies it, then a draft action record is created and a success state is shown.

## AC-012 GraphQL Top-Level Errors
Given Shopify returns top-level GraphQL errors, when a loader/action calls Admin GraphQL, then the app shows an API error state and does not mark the operation successful.

## AC-013 GraphQL User Errors
Given Shopify returns `userErrors`, when a mutation is attempted in future write-enabled flows, then the app shows validation errors tied to the operation.

## AC-014 Missing Scope
Given required scopes are not granted, when a protected screen needs that data, then the app shows a permission error with scopes needed and recovery guidance.

## AC-015 Expired Session
Given the session expires, when a protected loader runs, then the Shopify template authentication flow handles reauth and the app does not expose a stack trace.

## AC-016 Store Without Data
Given a shop has no products or no imported signals, when Dashboard and Products load, then empty states explain the next action.

## AC-017 Store With Many Products
Given a shop has many products, when catalog scans run in production, then reads must be cursor-paginated and risk calculations must avoid unbounded client payloads.

## AC-018 Mobile Viewport
Given a narrow viewport, when the merchant opens each screen, then content remains readable and key actions remain accessible.

## AC-019 Accessibility
Given any main screen is rendered, when axe scans it, then no critical accessibility violations are present.

## AC-020 CI
Given code is pushed to GitHub, when CI runs, then install, typecheck, lint, unit/integration tests and build run, with Shopify CLI checks allowed to continue when CI lacks login.

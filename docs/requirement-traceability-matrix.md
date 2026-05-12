# Requirement Traceability Matrix

| Requirement | Automated Test(s) | Manual/Deferred |
| --- | --- | --- |
| FR-001 | `tests/e2e/preview.spec.js`, `tests/accessibility/app.a11y.spec.js` | Shopify Admin install |
| FR-002 | `tests/e2e/preview.spec.js` | Embedded navigation in dev store |
| FR-003 | `tests/components/product-pulse-screens.test.jsx` | Real connector credentials deferred |
| FR-004 | `tests/unit/product-pulse-scoring.test.js` | Visual review |
| FR-005 | `tests/integration/product-pulse-actions.test.js` | Background worker deferred |
| FR-006 | `tests/components/product-pulse-screens.test.jsx` | Long-running production jobs deferred |
| FR-007 | `tests/components/product-pulse-screens.test.jsx` | Dev store scan |
| FR-008 | `tests/components/product-pulse-screens.test.jsx` | Large catalog manual later |
| FR-009 | `tests/components/product-pulse-screens.test.jsx`, `tests/e2e/preview.spec.js` | Real AI provider deferred |
| FR-010 | `tests/unit/product-pulse-validation.test.js`, `tests/integration/product-pulse-actions.test.js` | Shopify billing deferred |
| FR-011 | `tests/integration/product-pulse-actions.test.js` | Real Shopify write deferred |
| FR-012 | `tests/components/product-pulse-screens.test.jsx` | Production job queue deferred |
| FR-013 | `tests/components/product-pulse-screens.test.jsx` | Real chart library deferred |
| FR-014 | `tests/components/product-pulse-screens.test.jsx` | Real billing deferred |
| FR-015 | Build/typecheck | Template auth manual install |
| FR-016 | `tests/unit/product-pulse-validation.test.js` | Live GraphQL failure deferred |
| FR-017 | `tests/e2e/preview.spec.js`, `tests/accessibility/app.a11y.spec.js` | None |
| FR-018 | CI workflow | None |

## Acceptance Criteria Mapping
- AC-001: manual Shopify install plus build/typecheck.
- AC-002 to AC-011: component/integration/E2E preview tests.
- AC-012 to AC-014: unit validation helpers and permission/API states.
- AC-015: template auth manual test.
- AC-016 to AC-019: component/E2E/a11y tests.
- AC-020: `.github/workflows/qa.yml`.


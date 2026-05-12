# Test Matrix

| Area | Automated Coverage | Manual Coverage | Notes |
| --- | --- | --- | --- |
| Embedded auth shell | Build/typecheck | Shopify dev install | Template owns OAuth/session flow |
| Connect sources | Component, E2E preview, a11y | Real connector setup later | MVP uses fixture state |
| Coverage score | Unit | Visual review | Deterministic helper |
| Catalog scan | Integration, E2E preview | Dev store scan later | Background worker future |
| Running jobs | Component, E2E preview | Long-running job later | Fixture progress model |
| Dashboard | Component, E2E preview, a11y | Dev store review | Uses fixture snapshots |
| Products filtering | Component | Large catalog later | Search/filter deterministic |
| Product diagnosis | Unit, component, integration, E2E preview | Real AI provider later | AI output mocked/validated |
| Credits | Unit, integration | Billing later | Shopify billing future |
| Analytics | Component, a11y | Chart review | CSS visual blocks are accessible |
| GraphQL errors | Unit | Live API failure later | Normalization helper |
| CI | GitHub Actions | Review failed artifacts | E2E gated by repository variable |


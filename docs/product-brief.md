# Product Brief

## Product
ProductPulse AI is a Shopify embedded app that turns product quality signals into catalog actions. It connects product data, orders, refunds, returns, return reasons, reviews, CSV imports and future support/Q&A sources to identify which products create avoidable friction.

## Problem
Merchants usually see product problems across separate systems: reviews in one app, refunds in Shopify, return notes somewhere else and support tickets in another tool. That fragmentation makes it hard to know which products need a copy fix, fit note, FAQ, tag, support note or deeper product quality review.

## Target user
The primary user is an ecommerce operator, catalog manager, CX lead or founder who owns product quality, conversion and post-purchase experience.

## Merchant persona
- Shopify merchant with 50 to 5,000 products.
- Receives enough reviews, refunds or returns to see patterns but not enough time to manually read everything.
- Needs product-level actions, not generic analytics.
- Wants clear evidence before changing PDP copy, tagging products or briefing support.

## Main flow
1. Merchant opens the app in Shopify Admin.
2. Merchant connects or reviews data sources in Connect sources.
3. App displays a Data coverage score and missing-source guidance.
4. Merchant runs Catalog Signal Scan.
5. Running jobs shows import, grouping, scoring and recommendation jobs.
6. Dashboard ranks products by risk and recommends where to start.
7. Merchant opens Products and chooses a product.
8. Merchant runs AI Product Diagnosis, spending one credit.
9. Diagnosis shows likely cause, evidence, impact, issues and recommended actions.
10. Merchant applies draft actions such as product tag, PDP copy, FAQ, fit note or support note.
11. Analyses keeps history of completed and running diagnoses.
12. Analytics shows trends by signal, issue, source, collection and coverage.

## Value proposition
ProductPulse AI detects why certain products generate returns, bad reviews or purchase doubts, then converts those signals into concrete Shopify catalog improvements.

## MVP
- Embedded Shopify app using Shopify CLI, React Router, App Bridge and Polaris web components.
- PostgreSQL-backed Prisma schema for sessions, sources, jobs, risk snapshots, diagnoses, actions and credit ledger.
- Mocked but realistic local data model for products, sources, jobs, analytics and diagnoses.
- Deterministic risk scoring helpers for return rate, refund rate, review sentiment, signal coverage and impact.
- Visual and interactive screens for Connect sources, Running jobs, Dashboard, Products, Product diagnosis, Analytics, Analyses and Sources & Billing.
- Server actions for Catalog Signal Scan, product diagnosis credit validation and applying draft actions.
- QA automation with unit, component, integration, E2E and accessibility tests.
- Documentation, fixtures, mocks, CI and Docker setup.

## Future functionality outside MVP
- Live background workers for imports and AI jobs.
- Real connectors for Gorgias, Zendesk, Return Prime, Loop Returns, Yotpo, Loox and ProductPulse Q&A Block.
- Real billing and recurring app subscriptions.
- Bulk diagnosis queue with credit reservation.
- Theme app extension for PDP Q&A and public notes.
- Production AI gateway with prompt versioning, schema validation and usage metering.
- Multi-language issue classification and recommendation copy.

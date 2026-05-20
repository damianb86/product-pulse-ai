# AI Internal Actions

## Purpose

Phase 4 adds confirmed internal ProductPulse actions to the AI system. These actions can change ProductPulse app-owned data or queue ProductPulse app-owned jobs, but they do not mutate Shopify resources.

The assistant may suggest an action and create a server-stored proposal. The user must confirm it. The backend then reloads and executes the stored proposal.

## Boundary

Read-only AI tools and mutating internal actions are separate systems:

- Read-only tools live in `app/ai/tools/*` and expose compact ProductPulse data.
- Internal actions live in `app/ai/actions/*` and require explicit confirmation.
- The model can call `product_pulse_propose_internal_action` to create a pending proposal.
- The model cannot execute actions.
- ChatKit confirm/cancel payloads contain only `proposalId`.

## Persistence

Prisma models:

- `AiActionProposal`: server-stored pending/confirmed/executed/cancelled/expired/failed proposals.
- `AiActionAuditLog`: lifecycle audit log for proposed, confirmed, cancelled, executed, failed, and expired events.

Proposal rows include shop scope, optional user/conversation IDs, action name, target info, validated input, confirmation level, side-effect level, status, expiry, result, and safe error metadata.

External responses use sanitized proposal summaries. They do not include `shop`, `userId`, `conversationId`, or stored `proposedInput`.

## Supported Actions

- `product_pulse_run_product_diagnosis`: queues an internal ProductPulse diagnosis job for a stored product.
- `product_pulse_add_to_watchlist`: adds a stored product to the ProductPulse watchlist.
- `product_pulse_remove_from_watchlist`: removes a stored product from the ProductPulse watchlist.
- `product_pulse_run_watchlist_diagnoses`: queues internal diagnosis jobs for active watchlist products.
- `product_pulse_mark_recommended_action`: marks an existing ProductPulse recommendation/action as `dismissed`, `reviewed`, or `active`.
- `product_pulse_archive_internal_product_analysis`: removes app-owned ProductPulse analysis/tracking records for one product. This does not delete or change the Shopify product.

## Not Supported

The AI action layer intentionally does not support:

- Shopify product edits.
- Price, inventory, status, description, SEO, tag, metafield, variant, or image changes.
- Shopify delete/archive operations.
- Applying generated recommendation content to Shopify.
- Marking recommendations as applied when no app-only execution happened.
- Autonomous or scheduled action execution.
- Actions without confirmation.

## Confirmation Flow

1. The assistant uses read-only tools to gather context.
2. The assistant calls `product_pulse_propose_internal_action`.
3. `AiActionRegistry.createAiActionProposal()` validates input, checks entity ownership, stores the proposal, and logs `proposed`.
4. The final assistant response includes an `action_proposal` neutral block.
5. ChatKit renders a confirmation card with Confirm and Cancel.
6. Confirm calls the backend with only `proposalId`.
7. The backend reloads the proposal under the authenticated shop, checks status, expiry, ownership, and stored input, then executes the action.
8. Execution status is stored and audited.
9. ChatKit receives a deterministic `action_result` block from the backend. Confirm/cancel does not require another model turn.

## Security Model

- Tenant context comes only from `AiToolContext`, which is created from authenticated Shopify server session data.
- Action input schemas do not accept `shop`, `storeId`, `merchantId`, `userId`, or equivalent tenant identifiers.
- Product/entity ownership is checked when the proposal is created and again before execution.
- Proposal lookup filters by `id` and `shop`.
- Expired, cancelled, failed, and already executed proposals cannot run again.
- Service failures return short safe errors and do not expose raw stack traces.
- ProductPulse does not have app-level roles yet, so the placeholder permission check allows authenticated embedded app users. Higher-risk actions can be restricted in that function when roles exist.

## Endpoints

- `POST /api/ai/actions/propose`
- `POST /api/ai/actions/confirm`
- `POST /api/ai/actions/cancel`
- `POST /api/ai/chatkit/action` with `confirm_ai_action` and `cancel_ai_action`

The direct action endpoints are backend API surfaces for future UIs. ChatKit uses the existing ChatKit action endpoint.

## ChatKit Widgets

`app/ai/chatkit/widgets.ts` maps `action_proposal` blocks into ChatKit cards showing:

- title and summary;
- target entity;
- reason and expected result;
- risks and reversibility;
- confirmation level;
- Confirm and Cancel buttons.

Buttons send only `proposalId`. They do not include executable action input.

The same adapter maps `action_result` blocks into read-only result cards for completed, cancelled, or failed actions. Result cards show the safe backend message, target label, affected entities, and created job ID when available. They do not include mutation buttons.

ChatKit confirm/cancel actions are handled by the backend action registry directly and return result widgets without routing through another OpenAI response. The model still runs on OpenAI for normal chat turns and action proposal creation, but confirmed execution results are produced by ProductPulse backend state.

## Audit Logging

`AiActionAuditLog` records safe metadata:

- shop and optional user/conversation IDs;
- proposal ID;
- action name;
- target type and ID;
- event type;
- validated input;
- status;
- duration;
- safe summary or safe error.

## Tests

Added `tests/unit/product-pulse-ai-internal-actions.test.js` and extended orchestrator coverage in `tests/unit/product-pulse-ai-chat-orchestrator.test.js`.

Focused command:

```bash
npm test -- tests/unit/product-pulse-ai-internal-actions.test.js tests/unit/product-pulse-ai-chat-orchestrator.test.js tests/unit/product-pulse-ai-chatkit.test.js
```

## Future Steps

- Add role-based permission checks if ProductPulse introduces merchant roles.
- Add richer proposal text for high-risk actions.
- Add action-specific history surfaces in the app UI.
- Add Shopify mutation previews and confirmation only in a separate future phase with stricter permissions and no direct model execution.

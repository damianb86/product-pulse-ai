# AI Chat Support Contact

## Purpose

The ChatKit assistant can help merchants report ProductPulse app problems or contact the ProductPulse team from the chat.

This is not a Shopify mutation and does not change ProductPulse business data beyond storing the existing `ContactRequest` audit row.

## Runtime Flow

```text
Merchant message in ChatKit
-> ProductPulse AI orchestrator
-> OpenAI model decides whether support/contact details are complete
-> product_pulse_send_support_contact tool
-> server-side conversation transcript + page context
-> ContactRequest row
-> SMTP email to CONTACT_EMAIL
```

The SMTP delivery uses the existing email environment variables:

- `CONTACT_EMAIL`
- `EMAIL_HOST`
- `EMAIL_PORT`
- `EMAIL_USER`
- `EMAIL_PASS`

No SMTP secret is exposed to the browser or to ChatKit.

## Tool Behavior

The support contact tool accepts:

- report type: problem report or contact request;
- subject;
- user's message;
- assistant interpretation;
- requested outcome;
- optional related product reference/title;
- optional related data labels.

The server adds:

- authenticated shop;
- user/session IDs when available;
- conversation ID;
- current page context;
- recent chat transcript;
- timestamp.

Tenant identity always comes from the authenticated server-side `AiToolContext`.

## Assistant Behavior

If the user only says they are having a problem, the assistant should ask for enough detail to make the report useful.

When the user has described what they want to send, the assistant uses the support contact tool and then thanks the user:

> Thanks, the ProductPulse team received the report and will review it. We will follow up when the case is reviewed.

If SMTP delivery fails, the assistant should give a short safe error and ask the user to try again later.

## Email Content

Emails include both plain text and a formatted HTML version with:

- context table;
- user message;
- assistant interpretation;
- requested outcome;
- related product/data;
- recent chat transcript.

The email body is escaped and bounded before storage/sending.

## Tests

Covered by:

- `tests/unit/product-pulse-ai-support-contact.test.js`
- `tests/unit/product-pulse-ai-chat-orchestrator.test.js`

These tests mock SMTP delivery and do not send real email.

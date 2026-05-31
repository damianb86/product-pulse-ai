/* eslint-env node */
import { describe, expect, it } from "vitest";

const {
  getAiChatConfig,
} = await import("../../app/ai/chat/config.server");
const {
  getAiChatKitConfig,
  getAiChatKitClientConfig,
} = await import("../../app/ai/chatkit/config.server");
const {
  getAiFeatureFlags,
} = await import("../../app/ai/security/featureFlags.server");
const {
  canUseAiAssistant,
  canUseInternalAiAction,
} = await import("../../app/ai/security/permissions.server");
const {
  checkAiRateLimit,
  resetAiRateLimitForTests,
} = await import("../../app/ai/security/rateLimit.server");

const context = {
  shop: "shop-a.myshopify.com",
  userId: "user-1",
  sessionId: "session-1",
};

describe("ProductPulse AI production hardening", () => {
  it("disables ChatKit when the global AI assistant flag is off", () => {
    const env = {
      AI_ASSISTANT_ENABLED: "false",
      AI_CHATKIT_ENABLED: "true",
      OPENAI_API_KEY: "server-key",
      AI_CHATKIT_DOMAIN_KEY: "domain_pk_test",
    };

    expect(getAiFeatureFlags(env).assistantEnabled).toBe(false);
    const config = getAiChatKitConfig(env);
    expect(config.enabled).toBe(false);
    expect(config.disabledReason).toContain("AI_ASSISTANT_ENABLED");
  });

  it("keeps OpenAI secrets out of the ChatKit client config", () => {
    const clientConfig = getAiChatKitClientConfig({
      OPENAI_API_KEY: "sk-secret",
      AI_CHATKIT_DOMAIN_KEY: "domain_pk_public",
      AI_CHATKIT_ENABLED: "true",
    });

    expect(clientConfig.enabled).toBe(true);
    expect(JSON.stringify(clientConfig)).toContain("domain_pk_public");
    expect(JSON.stringify(clientConfig)).not.toContain("sk-secret");
  });

  it("does not require AI_CHATKIT_WORKFLOW_ID for custom backend mode", () => {
    const config = getAiChatKitConfig({
      OPENAI_API_KEY: "server-key",
      AI_CHATKIT_DOMAIN_KEY: "domain_pk_public",
      AI_CHATKIT_ENABLED: "true",
      AI_CHATKIT_WORKFLOW_ID: "",
    });

    expect(config.enabled).toBe(true);
    expect(config.disabledReason).toBe(null);
  });

  it("can disable internal actions without disabling read-only chat", () => {
    const env = {
      OPENAI_API_KEY: "server-key",
      AI_INTERNAL_ACTIONS_ENABLED: "false",
    };
    const chatConfig = getAiChatConfig(env);

    expect(chatConfig.assistantEnabled).toBe(true);
    expect(chatConfig.internalActionsEnabled).toBe(false);
    expect(canUseAiAssistant(context, env).allowed).toBe(true);
    expect(canUseInternalAiAction(context, null, env)).toMatchObject({
      allowed: false,
      code: "AI_INTERNAL_ACTIONS_DISABLED",
    });
  });

  it("rate limits by shop and user bucket", () => {
    resetAiRateLimitForTests();
    const env = {
      AI_CHAT_RATE_LIMIT_PER_MINUTE: "2",
      AI_RATE_LIMIT_WINDOW_MS: "60000",
    };
    const now = () => new Date("2026-05-20T12:00:00.000Z");

    expect(checkAiRateLimit({ context, bucket: "chat", env, now }).allowed).toBe(true);
    expect(checkAiRateLimit({ context, bucket: "chat", env, now }).allowed).toBe(true);
    const limited = checkAiRateLimit({ context, bucket: "chat", env, now });

    expect(limited.allowed).toBe(false);
    expect(limited.retryAfterSeconds).toBe(60);
  });

  it("keeps tenant rate limit buckets separate", () => {
    resetAiRateLimitForTests();
    const env = {
      AI_ACTION_RATE_LIMIT_PER_MINUTE: "1",
      AI_RATE_LIMIT_WINDOW_MS: "60000",
    };
    const now = () => new Date("2026-05-20T12:00:00.000Z");

    expect(checkAiRateLimit({ context, bucket: "action_confirm", env, now }).allowed).toBe(true);
    expect(checkAiRateLimit({ context, bucket: "action_confirm", env, now }).allowed).toBe(false);
    expect(checkAiRateLimit({
      context: { ...context, shop: "shop-b.myshopify.com" },
      bucket: "action_confirm",
      env,
      now,
    }).allowed).toBe(true);
  });
});

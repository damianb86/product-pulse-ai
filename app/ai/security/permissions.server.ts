import type { AiToolContext } from "../domain/types";
import type { AnyAiActionDefinition } from "../actions/types";
import { getAiFeatureFlags } from "./featureFlags.server";

export interface AiPermissionResult {
  allowed: boolean;
  code?: string;
  message?: string;
}

export function canUseAiAssistant(
  context: Pick<AiToolContext, "shop"> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AiPermissionResult {
  const flags = getAiFeatureFlags(env);
  if (!flags.assistantEnabled) {
    return {
      allowed: false,
      code: "AI_ASSISTANT_DISABLED",
      message: "AI assistant is disabled.",
    };
  }
  if (!context?.shop) {
    return {
      allowed: false,
      code: "AI_AUTH_REQUIRED",
      message: "Sign in to use the AI assistant.",
    };
  }
  return { allowed: true };
}

export function canUseInternalAiAction(
  context: Pick<AiToolContext, "shop"> | null | undefined,
  definition?: Pick<AnyAiActionDefinition, "confirmationLevel" | "sideEffectLevel"> | null,
  env: NodeJS.ProcessEnv = process.env,
): AiPermissionResult {
  const assistant = canUseAiAssistant(context, env);
  if (!assistant.allowed) return assistant;
  const flags = getAiFeatureFlags(env);
  if (!flags.internalActionsEnabled) {
    return {
      allowed: false,
      code: "AI_INTERNAL_ACTIONS_DISABLED",
      message: "AI internal actions are disabled.",
    };
  }
  if (!flags.actionConfirmationsEnabled) {
    return {
      allowed: false,
      code: "AI_ACTION_CONFIRMATIONS_DISABLED",
      message: "AI action confirmations are disabled.",
    };
  }
  void definition;
  return { allowed: true };
}

export function canUseAiAppMutation(
  context: Pick<AiToolContext, "shop"> | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AiPermissionResult {
  const assistant = canUseAiAssistant(context, env);
  if (!assistant.allowed) return assistant;
  const flags = getAiFeatureFlags(env);
  if (!flags.appMutationsEnabled) {
    return {
      allowed: false,
      code: "AI_APP_MUTATIONS_DISABLED",
      message: "AI ProductPulse mutations are disabled.",
    };
  }
  if (!flags.actionConfirmationsEnabled) {
    return {
      allowed: false,
      code: "AI_ACTION_CONFIRMATIONS_DISABLED",
      message: "AI action confirmations are disabled.",
    };
  }
  return { allowed: true };
}

export interface AiFeatureFlags {
  assistantEnabled: boolean;
  chatKitEnabled: boolean;
  internalActionsEnabled: boolean;
  appMutationsEnabled: boolean;
  actionConfirmationsEnabled: boolean;
  debugMode: boolean;
  evalMode: boolean;
}

export function getAiFeatureFlags(env: NodeJS.ProcessEnv = process.env): AiFeatureFlags {
  return {
    assistantEnabled: !isDisabled(env.AI_ASSISTANT_ENABLED),
    chatKitEnabled: !isDisabled(env.AI_CHATKIT_ENABLED),
    internalActionsEnabled: !isDisabled(env.AI_INTERNAL_ACTIONS_ENABLED),
    appMutationsEnabled: !isDisabled(env.AI_APP_MUTATIONS_ENABLED),
    actionConfirmationsEnabled: !isDisabled(env.AI_ACTION_CONFIRMATIONS_ENABLED),
    debugMode: isEnabled(env.AI_DEBUG_MODE) || (env.NODE_ENV === "development" && isEnabled(env.AI_CHATKIT_DEBUG)),
    evalMode: isEnabled(env.AI_EVAL_MODE) || isEnabled(env.AI_EVAL_REAL_OPENAI),
  };
}

export function isAiDisabledValue(value: unknown): boolean {
  return isDisabled(value);
}

export function isAiEnabledValue(value: unknown): boolean {
  return isEnabled(value);
}

function isDisabled(value: unknown): boolean {
  return ["0", "false", "off", "disabled"].includes(String(value ?? "").trim().toLowerCase());
}

function isEnabled(value: unknown): boolean {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value ?? "").trim().toLowerCase());
}

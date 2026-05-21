export const AI_MAX_PAGE_CONTEXT_CHARACTERS = 4_000;
export const AI_MAX_ACTION_INPUT_CHARACTERS = 4_000;
export const AI_MAX_CHATKIT_BODY_CHARACTERS = 24_000;

export function isJsonWithinCharacterLimit(value: unknown, maxCharacters: number): boolean {
  try {
    return JSON.stringify(value ?? null).length <= maxCharacters;
  } catch {
    return false;
  }
}

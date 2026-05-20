export function expectToolCalled(actualToolCalls, toolName) {
  if (!actualToolCalls.some((call) => call.toolName === toolName)) {
    throw new Error(`Expected tool to be called: ${toolName}`);
  }
}

export function expectToolNotCalled(actualToolCalls, toolName) {
  if (actualToolCalls.some((call) => call.toolName === toolName)) {
    throw new Error(`Expected tool not to be called: ${toolName}`);
  }
}

export function expectActionProposalCreated(actualActions, actionName) {
  if (!actualActions.proposed.some((action) => action.actionName === actionName)) {
    throw new Error(`Expected action proposal to be created: ${actionName}`);
  }
}

export function expectActionNotProposed(actualActions, actionName) {
  if (actualActions.proposed.some((action) => action.actionName === actionName)) {
    throw new Error(`Expected action not to be proposed: ${actionName}`);
  }
}

export function expectActionNotExecuted(actualActions, actionName) {
  if (actualActions.executed.some((action) => action.actionName === actionName)) {
    throw new Error(`Expected action not to be executed before confirmation: ${actionName}`);
  }
}

export function expectBlockType(result, blockType) {
  if (!result.blocks.some((block) => block.type === blockType)) {
    throw new Error(`Expected response block type: ${blockType}`);
  }
}

export function expectNoHallucinatedText(result, forbiddenText) {
  const serialized = JSON.stringify({
    assistantText: result.assistantText,
    blocks: result.blocks,
  }).toLowerCase();
  const found = forbiddenText.find((text) => serialized.includes(String(text).toLowerCase()));
  if (found) {
    throw new Error(`Response contained forbidden/hallucinated text: ${found}`);
  }
}

export function expectTenantIsolationPreserved(actualToolCalls, expectedShop) {
  const leaked = actualToolCalls.find((call) => call.context?.shop !== expectedShop);
  if (leaked) {
    throw new Error(`Tool call used wrong shop context: ${leaked.context?.shop}`);
  }
  const acceptedTenantInput = actualToolCalls.find((call) => (
    call.rawInput && typeof call.rawInput === "object" && "shop" in call.rawInput && call.validatedInputHasTenant === true
  ));
  if (acceptedTenantInput) {
    throw new Error("Tool call accepted a client/model-supplied tenant identifier.");
  }
}

export function expectCostBelowThreshold(result, thresholdUsd) {
  const totalUsd = result.metadata?.estimatedCost?.totalUsd;
  if (typeof totalUsd === "number" && totalUsd > thresholdUsd) {
    throw new Error(`Estimated cost ${totalUsd} exceeded threshold ${thresholdUsd}.`);
  }
}

export function expectValidStructuredResponse(result) {
  if (!result || typeof result.assistantText !== "string" || !Array.isArray(result.blocks)) {
    throw new Error("Assistant result is not a valid structured response.");
  }
}

import { PRODUCT_PULSE_AI_ACTION_NAMES } from "../actions/productPulseActions.server";
import { PRODUCT_PULSE_AI_APP_MUTATION_NAMES } from "../appMutations/productPulseAppMutations.server";
import { PRODUCT_PULSE_AI_TOOL_NAMES } from "../tools/productPulseTools.server";
import type {
  AppInteractionGuidance,
  AppInteractionGuidanceIntent,
  AppInteractionGuidanceOption,
} from "./types";

const SOURCE = {
  documentTitle: "ProductPulse Interaction Guidance",
  documentPath: "docs/app-knowledge/interaction-guidance.md",
  section: "Guided assistant capabilities",
};

export class AppInteractionGuidanceRepository {
  getGuidance(input: {
    query?: string | null;
    intent?: AppInteractionGuidanceIntent | null;
    pageType?: string | null;
    hasProductContext?: boolean | null;
    limit?: number | null;
  }): AppInteractionGuidance {
    const intent = input.intent || inferIntent(input.query || "");
    const options = guidanceOptionsForIntent(intent).slice(0, normalizeGuidanceLimit(input.limit));
    const productAwareSummary = input.hasProductContext
      ? "Puedo usar el producto abierto como contexto si la pregunta se refiere a este producto."
      : "Si la opción necesita producto, pedí el producto por nombre, handle o abrí la página del producto.";
    return {
      intent,
      title: guidanceTitle(intent),
      summary: `${guidanceSummary(intent)} ${productAwareSummary}`,
      clarificationQuestion: guidanceQuestion(intent, Boolean(input.hasProductContext), input.pageType || ""),
      options,
      suggestedReplies: options.slice(0, 4).map((option) => option.examplePrompt),
      caveats: [
        "Las opciones que cambian datos de ProductPulse requieren confirmación explícita.",
        "El chat no puede modificar Shopify directamente.",
      ],
      source: SOURCE,
      confidence: "high",
    };
  }
}

export function normalizeGuidanceLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 5;
  return Math.max(1, Math.min(6, Math.trunc(numeric)));
}

function inferIntent(query: string): AppInteractionGuidanceIntent {
  const normalized = normalizeText(query);
  if (/\b(shopify|publish|publicar|aplicar|apply|actualiz|update|precio|price|inventario|inventory|seo|metafield|descripcion)\b/.test(normalized)
    && /\b(shopify|publicar|aplicar|apply|actualiz|update)\b/.test(normalized)) {
    return "unsupported_shopify_mutation";
  }
  if (/\b(crea|crear|agrega|agregar|nueva|nuevo|add|create)\b/.test(normalized)
    && /\b(accion|action|recomendacion|recommendation)\b/.test(normalized)) {
    return "create_product_action";
  }
  if (/\b(edit|editar|reescrib|rewrite|modific|actualiz|regener)\b/.test(normalized)
    && /\b(accion|action|recomendacion|recommendation|texto|copy|descripcion|seo)\b/.test(normalized)) {
    return "edit_product_action";
  }
  if (/\b(watchlist|monitoreo|vigilar|seguimiento)\b/.test(normalized)) return "watchlist";
  if (/\b(formula|formula|calcula|calculo|score|puntaje|como funciona|quickscan|deep|diagnostico|metodologia|setting|configuracion)\b/.test(normalized)) {
    return "methodology_explanation";
  }
  if (/\b(producto|product|riesgo|risk|evidencia|evidence|metric|metrica|resumen|summary|info|informacion)\b/.test(normalized)) {
    return "product_information";
  }
  return "assistant_capabilities";
}

function guidanceTitle(intent: AppInteractionGuidanceIntent): string {
  return {
    assistant_capabilities: "Qué podés pedirme",
    create_product_action: "Crear una acción para el producto",
    edit_product_action: "Editar una acción existente",
    product_information: "Elegir información del producto",
    methodology_explanation: "Elegir explicación de ProductPulse",
    watchlist: "Opciones de watchlist",
    unsupported_shopify_mutation: "Alternativas seguras a cambios en Shopify",
  }[intent];
}

function guidanceSummary(intent: AppInteractionGuidanceIntent): string {
  return {
    assistant_capabilities: "Puedo leer datos de ProductPulse, explicar metodología, mostrar evidencia, proponer acciones internas y guardar acciones app-owned con confirmación.",
    create_product_action: "Antes de crear una acción necesito saber qué tipo de acción querés guardar en ProductPulse.",
    edit_product_action: "Puedo ayudarte a reescribir, marcar o ajustar una acción existente de ProductPulse.",
    product_information: "Puedo enfocar la respuesta en resumen, métricas, diagnóstico, evidencia o acciones recomendadas.",
    methodology_explanation: "Puedo explicar cálculos, pantallas y procesos reales documentados en ProductPulse.",
    watchlist: "Puedo leer el estado de watchlist o proponer cambios internos con confirmación.",
    unsupported_shopify_mutation: "No puedo aplicar cambios directos a Shopify desde el chat, pero puedo guardar una acción de ProductPulse para revisión.",
  }[intent];
}

function guidanceQuestion(intent: AppInteractionGuidanceIntent, hasProductContext: boolean, pageType: string): string {
  if (intent === "create_product_action") {
    return hasProductContext
      ? "Qué tipo de acción querés agregar a este producto?"
      : "Qué tipo de acción querés agregar y a qué producto?";
  }
  if (intent === "edit_product_action") return "Qué acción querés editar y qué cambio querés hacerle?";
  if (intent === "product_information") {
    return hasProductContext || pageType === "product"
      ? "Qué querés revisar de este producto?"
      : "De qué producto querés información y qué aspecto querés revisar?";
  }
  if (intent === "methodology_explanation") return "Qué parte de ProductPulse querés que te explique?";
  if (intent === "watchlist") return "Querés consultar la watchlist o proponer un cambio interno?";
  if (intent === "unsupported_shopify_mutation") return "Querés que cree una acción de ProductPulse para revisar el cambio sin tocar Shopify?";
  return "Qué querés hacer ahora?";
}

function guidanceOptionsForIntent(intent: AppInteractionGuidanceIntent): AppInteractionGuidanceOption[] {
  if (intent === "create_product_action") return createProductActionOptions();
  if (intent === "edit_product_action") return editProductActionOptions();
  if (intent === "product_information") return productInformationOptions();
  if (intent === "methodology_explanation") return methodologyOptions();
  if (intent === "watchlist") return watchlistOptions();
  if (intent === "unsupported_shopify_mutation") return shopifyMutationAlternativeOptions();
  return [
    ...productInformationOptions().slice(0, 2),
    ...methodologyOptions().slice(0, 2),
    ...createProductActionOptions().slice(0, 2),
  ];
}

function createProductActionOptions(): AppInteractionGuidanceOption[] {
  return [
    {
      id: "description_guidance",
      label: "Nota o guía de descripción",
      description: "Crea una acción de ProductPulse con texto sugerido para agregar, reemplazar o anteponer en la descripción.",
      examplePrompt: "Creá una acción para agregar una nota de expectativas a este producto.",
      category: "app_mutation",
      requiresProductContext: true,
      requiresConfirmation: true,
      backendCapability: { kind: "app_mutation", name: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductDescriptionDraft },
    },
    {
      id: "seo_recommendation",
      label: "Recomendación SEO",
      description: "Crea una acción app-owned con título o meta description SEO sugerida. No actualiza Shopify.",
      examplePrompt: "Creá una acción SEO para mejorar la meta description de este producto.",
      category: "app_mutation",
      requiresProductContext: true,
      requiresConfirmation: true,
      backendCapability: { kind: "app_mutation", name: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createSeoDraft },
    },
    {
      id: "qa_review",
      label: "QA / revisión interna",
      description: "Crea una acción interna para revisar calidad, proveedor, seguridad, devoluciones o defectos.",
      examplePrompt: "Creá una acción de QA para revisar las quejas de calidad de este producto.",
      category: "app_mutation",
      requiresProductContext: true,
      requiresConfirmation: true,
      backendCapability: { kind: "app_mutation", name: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductAction },
    },
    {
      id: "metafield_recommendation",
      label: "Metafield allowlisted",
      description: "Crea una acción de ProductPulse para un metafield permitido por configuración.",
      examplePrompt: "Creá una acción para el metafield allowlisted de material con valor sugerido.",
      category: "app_mutation",
      requiresProductContext: true,
      requiresConfirmation: true,
      backendCapability: { kind: "app_mutation", name: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createMetafieldValueDraft },
    },
    {
      id: "custom_recommendation",
      label: "Acción personalizada app-owned",
      description: "Crea una acción nueva con título, detalle, campo objetivo, prioridad y texto de trabajo.",
      examplePrompt: "Creá una acción personalizada para revisar las imágenes del producto y explicar el problema.",
      category: "app_mutation",
      requiresProductContext: true,
      requiresConfirmation: true,
      backendCapability: { kind: "app_mutation", name: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductAction },
    },
  ];
}

function editProductActionOptions(): AppInteractionGuidanceOption[] {
  return [
    {
      id: "rewrite_action_text",
      label: "Reescribir texto de una acción",
      description: "Regenera o edita el texto, título, detalle, prioridad o campo objetivo de una recomendación existente.",
      examplePrompt: "Reescribí la acción de descripción para que la nota sea más clara y en español.",
      category: "app_mutation",
      requiresProductContext: true,
      requiresConfirmation: true,
      backendCapability: { kind: "app_mutation", name: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.updateRecommendedActionDraft },
    },
    {
      id: "dismiss_action",
      label: "Dismiss / descartar",
      description: "Marca una recomendación como dismissed dentro de ProductPulse.",
      examplePrompt: "Descartá la acción de SEO porque no aplica a este producto.",
      category: "app_mutation",
      requiresProductContext: true,
      requiresConfirmation: true,
      backendCapability: { kind: "app_mutation", name: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.markRecommendedActionStatus },
    },
    {
      id: "mark_reviewed",
      label: "Marcar como revisada",
      description: "Marca una recomendación como revisada o completada en ProductPulse.",
      examplePrompt: "Marcá esta recomendación como revisada.",
      category: "app_mutation",
      requiresProductContext: true,
      requiresConfirmation: true,
      backendCapability: { kind: "app_mutation", name: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.markRecommendedActionStatus },
    },
  ];
}

function productInformationOptions(): AppInteractionGuidanceOption[] {
  return [
    {
      id: "product_summary",
      label: "Resumen del producto",
      description: "Muestra estado, riesgo, métricas clave y contexto compacto.",
      examplePrompt: "Mostrame un resumen compacto de este producto.",
      category: "read",
      requiresProductContext: true,
      requiresConfirmation: false,
      backendCapability: { kind: "tool", name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail },
    },
    {
      id: "diagnosis_explanation",
      label: "Diagnóstico y causa",
      description: "Explica por qué está marcado, qué señales pesan y qué confianza tiene el análisis.",
      examplePrompt: "Explicame por qué este producto está marcado como riesgoso.",
      category: "read",
      requiresProductContext: true,
      requiresConfirmation: false,
      backendCapability: { kind: "tool", name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail },
    },
    {
      id: "evidence",
      label: "Evidencia",
      description: "Lista snippets y fuentes que sostienen el diagnóstico.",
      examplePrompt: "Mostrame la evidencia más importante de este producto.",
      category: "read",
      requiresProductContext: true,
      requiresConfirmation: false,
      backendCapability: { kind: "tool", name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductEvidenceSnippets },
    },
    {
      id: "recommended_actions",
      label: "Acciones recomendadas",
      description: "Muestra acciones existentes y qué haría cada una.",
      examplePrompt: "Mostrame todas las acciones recomendadas de este producto.",
      category: "read",
      requiresProductContext: true,
      requiresConfirmation: false,
      backendCapability: { kind: "tool", name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail },
    },
    {
      id: "return_refund_resolution",
      label: "Returns y refunds",
      description: "Explica cuántos refunds están vinculados a returns, cuáles son return-only, refund-only o no atribuibles.",
      examplePrompt: "¿Los refunds de este producto están pasando después de returns?",
      category: "read",
      requiresProductContext: true,
      requiresConfirmation: false,
      backendCapability: { kind: "tool", name: PRODUCT_PULSE_AI_TOOL_NAMES.getProductReturnRefundResolution },
    },
  ];
}

function methodologyOptions(): AppInteractionGuidanceOption[] {
  return [
    {
      id: "score_formula",
      label: "Fórmula de un score",
      description: "Explica fórmula, inputs, rango, interpretación y límites de una métrica documentada.",
      examplePrompt: "Cómo se calcula Revenue at risk?",
      category: "explain",
      requiresProductContext: false,
      requiresConfirmation: false,
      backendCapability: { kind: "tool", name: "product_pulse_get_score_explanation" },
    },
    {
      id: "quickscan",
      label: "QuickScan",
      description: "Explica cómo se seleccionan candidatos y qué significa un scan rápido.",
      examplePrompt: "Cómo funciona QuickScan y cómo elige candidatos?",
      category: "explain",
      requiresProductContext: false,
      requiresConfirmation: false,
      backendCapability: { kind: "tool", name: "product_pulse_get_app_concept_explanation" },
    },
    {
      id: "deep_diagnosis",
      label: "Deep diagnosis",
      description: "Explica qué hace el diagnóstico profundo y qué datos puede actualizar dentro de ProductPulse.",
      examplePrompt: "Qué diferencia hay entre QuickScan y deep diagnosis?",
      category: "explain",
      requiresProductContext: false,
      requiresConfirmation: false,
      backendCapability: { kind: "tool", name: "product_pulse_search_app_knowledge" },
    },
    {
      id: "screen_guide",
      label: "Guía de pantalla",
      description: "Explica cómo leer Dashboard, Products, Product detail, Watchlist, Analytics o Settings.",
      examplePrompt: "Cómo debería leer el dashboard?",
      category: "explain",
      requiresProductContext: false,
      requiresConfirmation: false,
      backendCapability: { kind: "tool", name: "product_pulse_get_screen_guide" },
    },
  ];
}

function watchlistOptions(): AppInteractionGuidanceOption[] {
  return [
    {
      id: "watchlist_snapshot",
      label: "Ver watchlist",
      description: "Consulta estado actual, productos monitoreados y señales principales.",
      examplePrompt: "Mostrame el estado actual de la watchlist.",
      category: "read",
      requiresProductContext: false,
      requiresConfirmation: false,
      backendCapability: { kind: "tool", name: PRODUCT_PULSE_AI_TOOL_NAMES.getWatchlistSnapshot },
    },
    {
      id: "add_to_watchlist",
      label: "Agregar producto",
      description: "Propone agregar un producto a la watchlist de ProductPulse.",
      examplePrompt: "Agregá este producto a la watchlist.",
      category: "propose_action",
      requiresProductContext: true,
      requiresConfirmation: true,
      backendCapability: { kind: "internal_action", name: PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist },
    },
    {
      id: "run_watchlist",
      label: "Ejecutar diagnósticos",
      description: "Propone correr diagnósticos internos para productos activos de la watchlist.",
      examplePrompt: "Corré diagnósticos para la watchlist.",
      category: "propose_action",
      requiresProductContext: false,
      requiresConfirmation: true,
      backendCapability: { kind: "internal_action", name: PRODUCT_PULSE_AI_ACTION_NAMES.runWatchlistDiagnoses },
    },
  ];
}

function shopifyMutationAlternativeOptions(): AppInteractionGuidanceOption[] {
  return [
    {
      id: "save_productpulse_action",
      label: "Guardar acción en ProductPulse",
      description: "Crea una acción interna para revisión. No publica ni aplica cambios en Shopify.",
      examplePrompt: "Guardá una acción de ProductPulse con esta propuesta, sin modificar Shopify.",
      category: "app_mutation",
      requiresProductContext: true,
      requiresConfirmation: true,
      backendCapability: { kind: "app_mutation", name: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductAction },
    },
    {
      id: "description_recommendation",
      label: "Propuesta de descripción",
      description: "Guarda una recomendación de texto dentro de ProductPulse para revisar después.",
      examplePrompt: "Creá una acción con una descripción sugerida para este producto.",
      category: "app_mutation",
      requiresProductContext: true,
      requiresConfirmation: true,
      backendCapability: { kind: "app_mutation", name: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductDescriptionDraft },
    },
  ];
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

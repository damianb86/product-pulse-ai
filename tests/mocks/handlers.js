import { graphql, http, HttpResponse } from "msw";
import { graphqlSuccess, graphqlTopLevelError } from "../fixtures/product-pulse-fixtures";

export const handlers = [
  http.get("/health", () => HttpResponse.json({ ok: true })),
  graphql.query("ProductPulseProducts", () => HttpResponse.json(graphqlSuccess)),
];

export const errorHandlers = [
  graphql.query("ProductPulseProducts", () => HttpResponse.json(graphqlTopLevelError)),
];

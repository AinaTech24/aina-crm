import { resolveExpression } from "../context";
import type { ActionHandler } from "./index";

export const httpRequestHandler: ActionHandler<any> = {
  type: "http_request",
  async execute(ctx, node) {
    const cfg = node.config;
    const url = String(resolveExpression(cfg.url, ctx));
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg.headers as Record<string, string>)) {
      headers[k] = String(resolveExpression(v, ctx));
    }
    if (!headers["content-type"] && cfg.method !== "GET") {
      headers["content-type"] = "application/json";
    }

    const body =
      cfg.bodyTemplate && cfg.method !== "GET"
        ? typeof cfg.bodyTemplate === "string"
          ? String(resolveExpression(cfg.bodyTemplate, ctx))
          : JSON.stringify(cfg.bodyTemplate)
        : undefined;

    const res = await fetch(url, { method: cfg.method, headers, body });
    let parsed: unknown;
    try {
      parsed = await res.clone().json();
    } catch {
      parsed = await res.text();
    }

    const output = { url, method: cfg.method, status: res.status, body: parsed };
    const varsPatch: Record<string, unknown> = {};
    if (cfg.storeResultAs) {
      varsPatch[cfg.storeResultAs] = parsed;
    }
    return { kind: "continue", output, varsPatch };
  },
};

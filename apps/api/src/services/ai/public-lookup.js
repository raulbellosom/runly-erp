// apps/api/src/services/ai/public-lookup.js
//
// Shared, privacy-safe internet lookup for module assistants (spec:
// docs/superpowers/specs/2026-09-28-module-ai-public-lookup-design.md).
// The model never writes the query: callers pass a record's declared public
// descriptive fields (type, brand, model, year...) and the query is built
// here. Availability follows MirAI's web rules: GROQ_API_KEY + TAVILY_API_KEY,
// disabled by CHAT_MIRAI_WEB=false.

import { isIdentifyingAiField } from "@runly/module-engine";

const TAVILY_URL = "https://api.tavily.com/search";
const TAVILY_TIMEOUT_MS = 20_000;
const QUERY_MAX = 400;
const VALUE_MAX = 150;
const MAX_LOOKUPS_PER_TURN = 2;

export const PUBLIC_LOOKUP_WARNING = "Características generales del modelo; no verifican la configuración de esta unidad.";

export const PUBLIC_LOOKUP_PROMPT_RULE = "Solo usa la búsqueda pública cuando el usuario pida explícitamente buscar en internet o información pública/del fabricante (o acepte tu ofrecimiento de buscar). Si falta un dato en el registro y no pidió buscar, dilo y ofrece buscarlo en internet; nunca busques por iniciativa propia. Cuando lo pida, llama la herramienta directamente con el id del registro tomado del contexto; no pidas identificadores al usuario. Nunca menciones nombres de herramientas ni identificadores internos en la respuesta. Presenta los datos externos como información general del modelo, citando la fuente.";

// Field keys that identify a specific unit, person or company are never sent
// to a search engine; manifest validation rejects them too.
export const isIdentifyingField = isIdentifyingAiField;

export function createTavilyClient({ apiKey, fetchImpl = globalThis.fetch }) {
  return async function tavilySearch(query) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TAVILY_TIMEOUT_MS);
    try {
      const res = await fetchImpl(TAVILY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, query: String(query).slice(0, QUERY_MAX), max_results: 5, include_answer: "advanced", search_depth: "basic" }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const d = await res.text().catch(() => "");
        throw new Error(`Tavily ${res.status}: ${d.slice(0, 160)}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };
}

export function buildLookupQuery(subject, topic) {
  const values = Object.entries(subject ?? {})
    .filter(([key, value]) => !isIdentifyingField(key) && value !== null && value !== undefined && String(value).trim())
    .map(([, value]) => String(value).trim().slice(0, VALUE_MAX));
  if (!values.length) return "";
  return [...values, String(topic ?? "especificaciones fabricante").trim().slice(0, 80)].filter(Boolean).join(" ").slice(0, QUERY_MAX);
}

export function createPublicLookup({ env = process.env, fetchImpl, search = null } = {}) {
  const webKilled = String(env.CHAT_MIRAI_WEB ?? "true").toLowerCase() === "false";
  const tavilyKey = env.TAVILY_API_KEY || "";
  const enabled = Boolean(search) || (!webKilled && Boolean(tavilyKey) && Boolean(env.GROQ_API_KEY));
  const tavilySearch = search ?? (tavilyKey ? createTavilyClient({ apiKey: tavilyKey, fetchImpl: fetchImpl ?? globalThis.fetch }) : null);

  // Per assistant turn: at most MAX_LOOKUPS_PER_TURN searches.
  function createTurnBudget() {
    let used = 0;
    return { take: () => (++used <= MAX_LOOKUPS_PER_TURN) };
  }

  async function lookup({ subject, topic, budget }) {
    if (!enabled || !tavilySearch) return { error: "La búsqueda en internet no está configurada." };
    const query = buildLookupQuery(subject, topic);
    if (!query) return { error: "Faltan datos descriptivos (marca, modelo, tipo...) para buscar información pública." };
    if (budget && !budget.take()) return { error: `Máximo ${MAX_LOOKUPS_PER_TURN} búsquedas públicas por consulta.` };
    try {
      const data = await tavilySearch(query);
      const sources = (Array.isArray(data?.results) ? data.results : []).slice(0, 5).map(r => ({
        title: String(r.title ?? "").slice(0, 200),
        url: /^https?:\/\//.test(r.url ?? "") ? r.url : null,
        content: String(r.content ?? "").slice(0, 1000),
      }));
      return { origin: "external", warning: PUBLIC_LOOKUP_WARNING, query, summary: data?.answer ? String(data.answer).slice(0, 1500) : null, sources };
    } catch (err) {
      return { error: `No se pudo consultar internet: ${String(err?.message ?? err).slice(0, 160)}` };
    }
  }

  return { enabled, lookup, createTurnBudget, search: tavilySearch };
}

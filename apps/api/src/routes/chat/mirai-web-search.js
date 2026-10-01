// apps/api/src/routes/chat/mirai-web-search.js
//
// web_search inside MirAI's tool loop (spec §8). Generic queries only — the
// prompt forbids personal data, amounts and internal ids; every query is
// recorded in the run's tool log by the loop.
const MAX_PER_TURN = 2;

export const WEB_SEARCH_DEF = {
  type: "function",
  function: {
    name: "web_search",
    description: "Busca en internet informacion actual o publica (precios de mercado, horarios, noticias, especificaciones, datos de empresas publicas). La consulta debe ser generica: sin nombres de personas, correos, telefonos, montos ni identificadores internos.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Consulta en terminos genericos." } },
      required: ["query"],
    },
  },
};

export function createWebSearchTool({ search, enabled, checkRate }) {
  async function run(args, ctx) {
    if (!enabled) return { error: "La busqueda en internet no esta configurada." };
    const query = String(args?.query ?? "").trim().slice(0, 300);
    if (query.length < 3) return { error: "Escribe una consulta mas concreta." };
    ctx.webSearches = (ctx.webSearches ?? 0) + 1;
    if (ctx.webSearches > MAX_PER_TURN) return { error: `Maximo ${MAX_PER_TURN} busquedas en internet por consulta.` };
    if (!checkRate(ctx.actorProfileId)) return { error: "Estoy limitando las busquedas en internet; intenta en unos minutos." };
    try {
      const data = await search(query);
      return {
        answer: data?.answer ?? null,
        results: (Array.isArray(data?.results) ? data.results : []).slice(0, 5).map((r) => ({
          title: r.title ?? null, url: r.url ?? null, snippet: String(r.content ?? "").slice(0, 500),
        })),
        searchedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { error: `No pude buscar en internet: ${String(err?.message ?? err).slice(0, 120)}` };
    }
  }
  return { enabled: Boolean(enabled), def: WEB_SEARCH_DEF, run };
}

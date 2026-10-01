// apps/api/src/routes/chat/mirai-tool-loop.js
//
// The tool-calling loop shared by MirAI's direct turn and private panel.
// Stops one iteration early: a last model round could only request tools
// whose output no later iteration could act on.
export async function runMiraiToolLoop({
  callModel, messages, runners, ctx, toolLog, clampToolResult,
  maxIterations, tooManyStepsText, emptyText,
}) {
  for (let iter = 0; iter < maxIterations; iter += 1) {
    const iterations = iter + 1;
    if (iter === maxIterations - 1) return { text: tooManyStepsText, iterations };
    const msg = await callModel(messages);
    const toolCalls = msg?.tool_calls ?? [];
    if (!toolCalls.length) {
      const answer = String(msg?.content ?? "").trim();
      // A non-tool response with no content is a failed turn, not an answer.
      if (!answer) toolLog.push({ error: "respuesta vacia de Groq" });
      return { text: answer || emptyText, iterations };
    }
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: toolCalls });
    for (const call of toolCalls) {
      const name = call.function?.name;
      let args = {};
      try { args = JSON.parse(call.function?.arguments || "{}"); } catch { args = {}; }
      const runner = runners[name];
      const t0 = Date.now();
      let result;
      try {
        result = runner ? await runner(args, ctx) : { error: `Herramienta desconocida: ${name}` };
      } catch (err) {
        result = { error: `La herramienta fallo: ${String(err?.message ?? err).slice(0, 160)}` };
      }
      toolLog.push({ name, ms: Date.now() - t0, ok: !result?.error });
      messages.push({ role: "tool", tool_call_id: call.id, content: clampToolResult(result) });
    }
  }
  return { text: tooManyStepsText, iterations: maxIterations };
}

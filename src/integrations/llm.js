// Тонкая обёртка над OpenAI-совместимым эндпоинтом (chat/completions).
// Возвращает строку-ответ либо null при любой ошибке — вызывающий код
// должен уметь работать без LLM (детерминированный фолбэк).
export function createLlm({ apiKey, baseUrl, model, timeoutMs = 15000 }) {
  const url = baseUrl ? `${baseUrl.replace(/\/+$/, "")}/chat/completions` : null;
  const enabled = Boolean(apiKey && url && model);

  async function complete(system, user) {
    if (!enabled) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 200,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("LLM: HTTP", res.status, body.slice(0, 300));
        return null;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch (error) {
      console.error("LLM: запрос не удался:", error.message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  return { enabled, complete };
}

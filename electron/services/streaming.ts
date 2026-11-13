/** Collect OpenAI-compatible SSE while exposing only answer text, never reasoning. */
export async function collectChatStream(response: Response, onText: (text: string) => void): Promise<unknown> {
  if (!response.body) throw new Error('The provider returned an empty stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason: string | null = null;
  let usage: unknown;
  let model: unknown;
  let bytes = 0;
  let lastNotify = 0;
  const frame = (text: string) => {
    const data = text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const value = JSON.parse(data);
    if (value.error) throw new Error(value.error.message || 'Provider streaming error.');
    if (value.usage) usage = value.usage;
    if (value.model) model = value.model;
    const choice = value.choices?.find((entry: { index?: number }) => !entry.index);
    if (typeof choice?.delta?.content === 'string') content += choice.delta.content;
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    if (Date.now() - lastNotify >= 80) { onText(content); lastNotify = Date.now(); }
  };
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 8 * 1024 * 1024) throw new Error('Provider stream exceeds the response limit.');
      buffer += decoder.decode(next.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { frame(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); }
    }
    buffer += decoder.decode();
    if (buffer.trim()) frame(buffer);
    if (!finishReason) throw new Error('The provider stream ended without a completion status.');
    onText(content);
    return { choices: [{ message: { content }, finish_reason: finishReason }], usage, model };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { requestChat, setOllamaApiKey } from './ai';

const messages = [{ role: 'user' as const, content: 'test' }];

test('chat request retries an empty transient response and returns completion diagnostics', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  setOllamaApiKey('test-key');
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'digest body' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
    }), { status: 200 });
  };
  try {
    const result = await requestChat(messages, 'test-model', { retryDelayMs: 0 });
    assert.equal(calls, 2);
    assert.equal(result.content, 'digest body');
    assert.equal(result.finishReason, 'stop');
    assert.deepEqual(result.usage, { promptTokens: 10, completionTokens: 4, totalTokens: 14 });
    assert.equal(result.requestAttempts, 2);
  } finally {
    globalThis.fetch = originalFetch;
    setOllamaApiKey('');
  }
});

test('chat request does not retry authentication or other permanent client errors', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  setOllamaApiKey('test-key');
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 401 });
  };
  try {
    await assert.rejects(
      requestChat(messages, 'test-model', { retryDelayMs: 0 }),
      /invalid key/
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    setOllamaApiKey('');
  }
});

test('chat request aborts the active provider request when the batch is cancelled', async () => {
  const originalFetch = globalThis.fetch;
  setOllamaApiKey('test-key');
  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });
  try {
    const controller = new AbortController();
    const pending = requestChat(messages, 'test-model', { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError');
  } finally {
    globalThis.fetch = originalFetch;
    setOllamaApiKey('');
  }
});

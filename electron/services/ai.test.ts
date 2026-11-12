import assert from 'node:assert/strict';
import test from 'node:test';
import { requestChat, setOllamaApiKey, setProviderConnection } from './ai';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const messages = [{ role: 'user' as const, content: 'test' }];

test('cloud requests impose no output token cap and accept complete answers beyond the former ceiling', async () => {
  const originalFetch = globalThis.fetch;
  setOllamaApiKey('test-key');
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'max_tokens'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'max_completion_tokens'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'stop'), false);
    assert.deepEqual(body.messages, messages);
    return Response.json({
      choices: [{ message: { content: 'complete final answer', reasoning: 'internal reasoning' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 100_000, total_tokens: 100_010 }
    });
  };
  try {
    const result = await requestChat(messages, 'thinking-model');
    assert.equal(result.content, 'complete final answer');
    assert.equal(result.usage?.completionTokens, 100_000);
    assert.equal(result.requestAttempts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    setOllamaApiKey('');
  }
});

test('server-truncated responses fail before returning partial text or valid-looking JSON', async () => {
  const originalFetch = globalThis.fetch;
  setOllamaApiKey('test-key');
  try {
    for (const content of ['', 'partial note', '{"passed":true,"findings":[]}']) {
      let calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return Response.json({
          choices: [{ message: { content, reasoning_content: 'internal reasoning' }, finish_reason: 'length' }],
          usage: { prompt_tokens: 10, completion_tokens: 100_000, total_tokens: 100_010 }
        });
      };
      await assert.rejects(requestChat(messages, 'thinking-model', { retryDelayMs: 0 }), error => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /model: thinking-model; finish reason: length; completion tokens: 100000/);
        assert.match(error.message, /Scholarly sent no output token cap/);
        assert.match(error.message, /No incomplete answer was accepted/);
        assert.doesNotMatch(error.message, /internal reasoning/);
        return true;
      });
      // An identical uncapped retry cannot raise the server's own limit.
      assert.equal(calls, 1);
    }
  } finally {
    globalThis.fetch = originalFetch;
    setOllamaApiKey('');
  }
});

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

test('Claude and Codex subscriptions route through their CLIs without an Ollama key or HTTP call', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scholarly-provider-test-'));
  const executable = path.join(directory, 'fake-cli');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Subscription routing must not use HTTP'); };
  await fs.writeFile(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'auth') { console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })); process.exit(0); }
if (args[0] === 'login') { console.error('Logged in using ChatGPT'); process.exit(0); }
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  if (!input.includes('한국어 question')) process.exit(2);
  if (args.includes('--output-last-message')) fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'Codex note');
  else console.log(JSON.stringify({ subtype: 'success', is_error: false, result: 'Claude note' }));
});
`, { mode: 0o700 });
  try {
    setOllamaApiKey('');
    for (const provider of ['claude', 'codex'] as const) {
      setProviderConnection({ provider, claudePath: executable, codexPath: executable });
      const completion = await requestChat([{ role: 'user', content: '한국어 question' }], '');
      assert.equal(completion.content, provider === 'claude' ? 'Claude note' : 'Codex note');
    }
  } finally {
    globalThis.fetch = originalFetch;
    setProviderConnection({ provider: 'ollama', claudePath: '', codexPath: '' });
    await fs.rm(directory, { recursive: true, force: true });
  }
});

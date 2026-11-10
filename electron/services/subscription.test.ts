import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildSubscriptionArgs, parseClaudeResult, runCLI, subscriptionEnvironment } from './subscription';

test('subscription commands disable tools and persistence without permission bypass', () => {
  const claude = buildSubscriptionArgs('claude', 'sonnet', '/tmp/result.md');
  assert.equal(claude[claude.indexOf('--tools') + 1], '');
  assert.ok(claude.includes('--safe-mode'));
  assert.ok(claude.includes('--no-session-persistence'));
  const codex = buildSubscriptionArgs('codex', '', '/tmp/result.md');
  assert.ok(codex.includes('read-only'));
  assert.ok(codex.includes('--ignore-user-config'));
  assert.ok(codex.includes('features.shell_tool=false'));
  assert.ok(codex.includes('--ephemeral'));
  assert.ok(!codex.includes('--model'));
  assert.ok(![...claude, ...codex].some(arg => /bypass/.test(arg)));
});

test('Claude JSON errors cannot be mistaken for generated notes', () => {
  assert.equal(parseClaudeResult('{"subtype":"success","result":"note","is_error":false}').content, 'note');
  assert.throws(() => parseClaudeResult('{"subtype":"error_max_turns","result":"partial"}'));
  assert.throws(() => parseClaudeResult('{"subtype":"success","result":"quota","is_error":true}'));
});

test('subscription environment excludes metered API credentials without mutating parent', () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-only';
  try {
    assert.equal(subscriptionEnvironment().OPENAI_API_KEY, undefined);
    assert.equal(process.env.OPENAI_API_KEY, 'test-only');
  } finally {
    if (previous === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('CLI runner sends large Unicode prompts by stdin with literal shell syntax', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scholarly-cli-test-'));
  try {
    const input = '한국어 $(not-a-command) `literal` '.repeat(10_000);
    const output = await runCLI(process.execPath, ['-e', "process.stdin.pipe(process.stdout)"], input, directory);
    assert.equal(output.code, 0);
    assert.equal(output.stdout, input);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('CLI runner cancels and times out child processes', async () => {
  const controller = new AbortController();
  const running = runCLI(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', os.tmpdir(), controller.signal);
  controller.abort();
  await assert.rejects(running, { name: 'AbortError' });
  await assert.rejects(runCLI(process.execPath, ['-e', 'setInterval(()=>{},1000)'], '', os.tmpdir(), undefined, 50), /timed out/);
});

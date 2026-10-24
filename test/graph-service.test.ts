import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Worker } from 'node:worker_threads';
import { GraphService } from '../src/graph-service.ts';
import { contentHash, type FileSnapshot } from '../src/git.ts';

test('builds the captured graph off the main thread and reuses the immutable review result', async () => {
  const service = new GraphService();
  const after = 'export function captured() { return 1; }\n';
  const file: FileSnapshot = { path: 'captured.ts', before: '', after, beforeHash: contentHash(''), afterHash: contentHash(after), status: 'added', binary: false };
  try {
    let yielded = false;
    setImmediate(() => { yielded = true; });
    const review = { id: 'captured', files: [file] };
    const graph = await service.build(review);
    assert.ok(graph.symbols.some(symbol => symbol.name === 'captured'));
    assert.equal(yielded, true, 'Parsing does not block the main event loop');
    assert.equal(await service.build(review), graph, 'The immutable snapshot result is cached');
  } finally { service.dispose(); }
});

test('keeps a 10,000-function comparison complete and reuses parsed content on refresh', { timeout: 20_000 }, async () => {
  const service = new GraphService();
  const after = Array.from({ length: 10_000 }, (_, index) => `function item${index}() { return ${index}; }`).join('\n') + '\n';
  const file: FileSnapshot = { path: 'large.ts', before: '', after, beforeHash: contentHash(''), afterHash: contentHash(after), status: 'added', binary: false };
  try {
    const start = performance.now();
    const graph = await service.build({ id: 'large', files: [file] });
    const cold = performance.now() - start;
    assert.equal(graph.symbols.length, 10_000);
    assert.deepEqual(graph.files[0].changes, { added: 10_000, removed: 0 });
    const refresh = performance.now();
    const refreshed = await service.build({ id: 'refreshed', files: [file] });
    assert.equal(refreshed.symbols.length, 10_000);
    assert.equal(refreshed.symbols[9999].after?.startLine, 10_000);
    console.log(`10,000 functions: cold ${Math.round(cold)} ms, refresh ${Math.round(performance.now() - refresh)} ms`);
  } finally { service.dispose(); }
});

test('a worker-reported failure does not cache a rejected review result', async () => {
  const service = new GraphService();
  const after = 'export function recovered() { return 1; }\n';
  const file: FileSnapshot = { path: 'recovered.ts', before: '', after, beforeHash: contentHash(''), afterHash: contentHash(after), status: 'added', binary: false };
  try {
    await assert.rejects(service.build({ id: 'retry-worker', files: [{ ...file, path: 42 as unknown as string }] }), /path.*string/);
    const graph = await service.build({ id: 'retry-worker', files: [file] });
    assert.equal(graph.reviewId, 'retry-worker');
    assert.ok(graph.symbols.some(symbol => symbol.name === 'recovered'), 'The worker can return a successful result after its earlier error');
  } finally { service.dispose(); }
});


test('a terminated worker rejects pending analysis and can rebuild the same captured review', { timeout: 20_000 }, async () => {
  const service = new GraphService();
  const after = Array.from({ length: 10_000 }, (_, index) => `function interrupted${index}() { return ${index}; }`).join('\n') + '\n';
  const file: FileSnapshot = { path: 'interrupted.ts', before: '', after, beforeHash: contentHash(''), afterHash: contentHash(after), status: 'added', binary: false };
  const review = { id: 'interrupted-review', files: [file] };
  try {
    const pending = service.build(review);
    // Inject failure at the real worker boundary; assert recovery through the service API.
    const worker = (service as unknown as { worker?: Worker }).worker;
    assert.ok(worker, 'The pending build owns a worker');
    assert.ok(worker.threadId > 0, 'The fault targets an active Node worker');
    const rejected = assert.rejects(pending, /Graph worker stopped \(\d+\)\./);
    await worker.terminate();
    await rejected;
    const graph = await service.build(review);
    assert.equal(graph.reviewId, review.id);
    assert.equal(graph.symbols.length, 10_000, 'A fresh worker rebuilds the complete original snapshot');
    assert.equal(graph.symbols[9999].after?.startLine, 10_000);
  } finally { service.dispose(); }
});

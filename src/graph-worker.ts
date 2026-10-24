import { parentPort } from 'node:worker_threads';
import { buildChangeGraph } from './change-graph.ts';
import type { Comparison } from './git.ts';

let jobs = Promise.resolve();
parentPort!.on('message', (message: { id: number; review: Pick<Comparison, 'id' | 'files'> }) => {
  jobs = jobs.then(async () => {
    try { parentPort!.postMessage({ id: message.id, graph: await buildChangeGraph(message.review) }); }
    catch (error) { parentPort!.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
  });
});

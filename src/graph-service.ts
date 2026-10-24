import type { Comparison } from './git.ts';
import type { ChangeGraph } from './change-graph.ts';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

export class GraphService {
  private worker?: Worker;
  private nextId = 0;
  private disposed = false;
  private readonly cache = new Map<string, Promise<ChangeGraph>>();
  private readonly pending = new Map<number, { resolve: (graph: ChangeGraph) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  build(review: Pick<Comparison, 'id' | 'files'>): Promise<ChangeGraph> {
    if (this.disposed) return Promise.reject(new Error('Graph service was closed.'));
    const cached = this.cache.get(review.id);
    if (cached) { this.cache.delete(review.id); this.cache.set(review.id, cached); return cached; }
    const worker = this.getWorker(), id = ++this.nextId;
    const result = new Promise<ChangeGraph>((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('Graph analysis exceeded 60 seconds. Try a smaller comparison.')), 60_000);
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, review: { id: review.id, files: review.files } });
    });
    this.cache.set(review.id, result);
    void result.catch(() => { if (this.cache.get(review.id) === result) this.cache.delete(review.id); });
    while (this.cache.size > 3) this.cache.delete(this.cache.keys().next().value!);
    return result;
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(path.join(__dirname, 'graph-worker.js'));
    this.worker = worker;
    worker.on('message', (message: { id: number; graph?: ChangeGraph; error?: string }) => {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer); this.pending.delete(message.id);
      if (message.graph) pending.resolve(message.graph);
      else pending.reject(new Error(message.error ?? 'Graph analysis failed.'));
    });
    worker.on('error', error => this.fail(error));
    worker.on('exit', code => { if (this.worker === worker) this.fail(new Error(`Graph worker stopped (${code}).`)); });
    return worker;
  }

  private fail(error: Error): void {
    const worker = this.worker; this.worker = undefined;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.cache.clear(); void worker?.terminate();
  }

  dispose(): void { this.disposed = true; this.fail(new Error('Graph service was closed.')); }
}

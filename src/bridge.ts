import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { repositoryInfo } from './git.ts';
import type { ReviewStore } from './review.ts';

export function defaultRegistry(): string {
  return process.env.AGENT_DIFF_REVIEW_REGISTRY ?? path.join(os.homedir(), '.agent-diff-review', 'bridges');
}

export class Bridge {
  readonly server: Server;
  url = '';
  readonly token = randomBytes(32).toString('hex');
  readonly id: string;
  readonly registration: string;
  constructor(readonly store: ReviewStore, readonly repository: string, readonly commonDir: string, readonly registryDirectory: string) {
    this.id = createHash('sha256').update(store.filename).digest('hex').slice(0, 24);
    this.registration = path.join(registryDirectory, `${this.id}.json`);
    this.server = createServer((request, response) => {
      void this.route(request, response).catch(error => {
        if (!response.destroyed) this.json(response, 400, { error: error instanceof Error ? error.message : String(error) });
      });
    });
    this.server.requestTimeout = 35_000;
  }
  private json(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(value));
  }
  private async body(request: IncomingMessage): Promise<Record<string, unknown>> {
    if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Expected application/json.');
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      bytes += chunk.length;
      if (bytes > 64 * 1024) throw new Error('Request exceeds 64 KiB.');
      chunks.push(Buffer.from(chunk));
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object.');
    return body as Record<string, unknown>;
  }
  private text(body: Record<string, unknown>, key: string): string {
    const value = body[key];
    if (typeof value !== 'string' || !value.trim() || value.length > 16_000) throw new Error(`Invalid ${key}.`);
    return value;
  }
  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.headers.origin) return this.json(response, 403, { error: 'Browser-origin requests are not accepted.' });
    if (request.headers.authorization !== `Bearer ${this.token}`) return this.json(response, 401, { error: 'Authentication required.' });
    const url = new URL(request.url ?? '/', this.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return this.json(response, 200, { protocolVersion: 1, bridgeId: this.id, repository: this.repository, commonDir: this.commonDir });
    }
    if (request.method === 'POST' && url.pathname === '/connect') {
      const body = await this.body(request);
      const info = await repositoryInfo(this.text(body, 'cwd'));
      if (info.commonDir !== this.commonDir) throw new Error('This VS Code window belongs to a different repository.');
      const connection = await this.store.connect(info.root, info.commonDir, this.text(body, 'label'));
      return this.json(response, 200, connection);
    }
    const match = /^\/connections\/([a-zA-Z0-9-]+)\/(wait|ack|reply|disconnect)$/.exec(url.pathname);
    if (match) {
      const [, connectionId, action] = match;
      this.store.connection(connectionId);
      if (action === 'wait' && request.method === 'GET') {
        const timeout = Number(url.searchParams.get('timeout') ?? 25);
        if (!Number.isFinite(timeout) || timeout < 0 || timeout > 25) throw new Error('Timeout must be between 0 and 25 seconds.');
        const batch = this.store.next(connectionId);
        if (batch) return this.json(response, 200, this.store.payload(batch));
        await new Promise<void>(resolve => {
          const finish = (payload: unknown) => {
            clearTimeout(timer);
            this.store.events.off('change', changed);
            response.off('close', closed);
            if (!response.destroyed) this.json(response, 200, payload);
            resolve();
          };
          const changed = () => {
            try {
              const next = this.store.next(connectionId);
              if (next) finish(this.store.payload(next));
            } catch { finish({ type: 'closed', connectionId }); }
          };
          const closed = () => { clearTimeout(timer); this.store.events.off('change', changed); resolve(); };
          const timer = setTimeout(() => finish({ type: 'pending', connectionId }), timeout * 1000);
          this.store.events.on('change', changed);
          response.once('close', closed);
          changed();
        });
        return;
      }
      if (action === 'ack' && request.method === 'POST') {
        const body = await this.body(request);
        await this.store.acknowledge(connectionId, this.text(body, 'batchId'));
        return this.json(response, 200, { type: 'acknowledged' });
      }
      if (action === 'reply' && request.method === 'POST') {
        const body = await this.body(request);
        await this.store.reply(connectionId, this.text(body, 'commentId'), this.text(body, 'message'));
        return this.json(response, 200, { type: 'replied' });
      }
      if (action === 'disconnect' && request.method === 'POST') {
        await this.store.disconnect(connectionId);
        return this.json(response, 200, { type: 'disconnected' });
      }
    }
    this.json(response, 404, { error: 'Unknown bridge route.' });
  }
  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => { this.server.removeListener('error', reject); resolve(); });
    });
    const address = this.server.address();
    if (address && typeof address !== 'string') this.url = `http://127.0.0.1:${address.port}`;
    await mkdir(this.registryDirectory, { recursive: true, mode: 0o700 });
    await writeFile(this.registration, JSON.stringify({ protocolVersion: 1, bridgeId: this.id, url: this.url, token: this.token, repository: this.repository, commonDir: this.commonDir }), { mode: 0o600 });
  }
  async dispose(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
    try {
      const record = JSON.parse(await readFile(this.registration, 'utf8'));
      if (record.token === this.token) await rm(this.registration, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

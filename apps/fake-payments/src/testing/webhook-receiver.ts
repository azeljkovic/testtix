import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedWebhook {
  headers: IncomingHttpHeaders;
  /** The raw body, exactly as signed. */
  body: string;
  receivedAt: number;
}

/** What the stub does with the nth request (1-based): answer with a status, or never answer. */
export type Respond = (n: number) => number | 'hang';

/**
 * A webhook receiver on a local port that records every request. Answers 200 unless told
 * otherwise with `respond`.
 */
export class WebhookReceiver {
  readonly received: ReceivedWebhook[] = [];
  respond: Respond = () => 200;
  private readonly hanging: ServerResponse[] = [];
  private readonly server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      this.received.push({
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
        receivedAt: Date.now(),
      });
      const action = this.respond(this.received.length);
      if (action === 'hang') this.hanging.push(res);
      else res.writeHead(action).end();
    });
  });

  static async start(): Promise<WebhookReceiver> {
    const receiver = new WebhookReceiver();
    await new Promise<void>((resolve) => receiver.server.listen(0, '127.0.0.1', resolve));
    return receiver;
  }

  get url(): string {
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/webhooks/payments`;
  }

  reset(): void {
    this.received.length = 0;
    this.respond = () => 200;
  }

  async close(): Promise<void> {
    for (const res of this.hanging) res.destroy();
    this.server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}

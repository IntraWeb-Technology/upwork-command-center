import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import type { AnalyzeRequest } from '@/contracts';
import { loadFixture } from '@/test/contract-fixtures';

import { createRemoteTransport } from './remote-transport';

const WEBHOOK_TOKEN = 'test-webhook-token-0123456789abcdefghij';
const request = loadFixture('analyze', 'valid', 'request.paste.json') as AnalyzeRequest;

interface Received {
  url: string | undefined;
  method: string | undefined;
  token: string | string[] | undefined;
  body: unknown;
}

type Responder = (res: ServerResponse, attempt: number, req: IncomingMessage) => void;

let server: Server | undefined;

async function startServer(responder: Responder) {
  const received: Received[] = [];
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    req.on('end', () => {
      received.push({
        url: req.url,
        method: req.method,
        token: req.headers['x-ujh-token'],
        body: JSON.parse(raw)
      });
      responder(res, received.length, req);
    });
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, received };
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const acceptedAck = { accepted: true, run_id: request.run_id, execution_ref: 'exec-123' };

afterEach(async () => {
  if (!server) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe('remote n8n transport', () => {
  it('posts the request to the contract webhook with header auth and parses the ack', async () => {
    const { baseUrl, received } = await startServer((res) => reply(res, 200, acceptedAck));
    const transport = createRemoteTransport({
      baseUrl: `${baseUrl}/`,
      webhookToken: WEBHOOK_TOKEN
    });

    expect(await transport.dispatch(request)).toEqual({
      type: 'accepted',
      executionRef: 'exec-123'
    });
    expect(received).toEqual([
      { url: '/webhook/ujh-cc/analyze', method: 'POST', token: WEBHOOK_TOKEN, body: request }
    ]);
  });

  it('maps a contract rejection (HTTP 400) to INVALID_INPUT', async () => {
    const { baseUrl } = await startServer((res) =>
      reply(res, 400, {
        accepted: false,
        error: { code: 'INVALID_INPUT', message: 'listing_text is required' }
      })
    );
    const transport = createRemoteTransport({ baseUrl, webhookToken: WEBHOOK_TOKEN });
    expect(await transport.dispatch(request)).toEqual({
      type: 'rejected',
      code: 'INVALID_INPUT',
      message: 'listing_text is required'
    });
  });

  it.each([401, 403, 404])('treats HTTP %i as a definite rejection', async (status) => {
    const { baseUrl, received } = await startServer((res) => reply(res, status, {}));
    const transport = createRemoteTransport({ baseUrl, webhookToken: WEBHOOK_TOKEN });
    expect(await transport.dispatch(request)).toMatchObject({
      type: 'rejected',
      code: 'UPSTREAM_UNAVAILABLE'
    });
    expect(received).toHaveLength(1);
  });

  it('retries a 502/503 once with the same run_id and accepts the second ack', async () => {
    const { baseUrl, received } = await startServer((res, attempt) =>
      attempt === 1 ? reply(res, 503, 'unavailable') : reply(res, 200, acceptedAck)
    );
    const transport = createRemoteTransport({ baseUrl, webhookToken: WEBHOOK_TOKEN });
    expect((await transport.dispatch(request)).type).toBe('accepted');
    expect(received.map((r) => (r.body as AnalyzeRequest).run_id)).toEqual([
      request.run_id,
      request.run_id
    ]);
  });

  it('rejects as UPSTREAM_UNAVAILABLE after a second 502/503', async () => {
    const { baseUrl, received } = await startServer((res) => reply(res, 502, 'bad gateway'));
    const transport = createRemoteTransport({ baseUrl, webhookToken: WEBHOOK_TOKEN });
    expect(await transport.dispatch(request)).toMatchObject({
      type: 'rejected',
      code: 'UPSTREAM_UNAVAILABLE'
    });
    expect(received).toHaveLength(2);
  });

  it.each([
    ['HTTP 500', (res: ServerResponse) => reply(res, 500, {})],
    ['HTTP 504', (res: ServerResponse) => reply(res, 504, {})],
    ['a 200 without a valid ack', (res: ServerResponse) => reply(res, 200, { ok: true })],
    ['a 200 that is not JSON', (res: ServerResponse) => reply(res, 200, '<html>')],
    [
      'an ack for another run',
      (res: ServerResponse) => reply(res, 200, { ...acceptedAck, run_id: 'other_run' })
    ],
    [
      'a dropped connection',
      (_res: ServerResponse, _n: number, req: IncomingMessage) => req.socket.destroy()
    ]
  ])('treats %s as ambiguous without retrying', async (_label, responder) => {
    const { baseUrl, received } = await startServer(responder);
    const transport = createRemoteTransport({ baseUrl, webhookToken: WEBHOOK_TOKEN });
    expect((await transport.dispatch(request)).type).toBe('ambiguous');
    expect(received).toHaveLength(1);
  });

  it('treats an acknowledgement timeout as ambiguous', async () => {
    const { baseUrl } = await startServer(() => {
      // Never responds.
    });
    const transport = createRemoteTransport({
      baseUrl,
      webhookToken: WEBHOOK_TOKEN,
      timeoutMs: 200
    });
    expect(await transport.dispatch(request)).toEqual({ type: 'ambiguous', reason: 'timeout' });
  });

  it('rejects when n8n refuses connections, after one retry', async () => {
    const { baseUrl } = await startServer(() => {});
    server!.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const transport = createRemoteTransport({ baseUrl, webhookToken: WEBHOOK_TOKEN });
    expect(await transport.dispatch(request)).toEqual({
      type: 'rejected',
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'n8n is unavailable (ECONNREFUSED)'
    });
  });
});

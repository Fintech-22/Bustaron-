import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchHealth, submitTx } from '../services/m3Backend';

/**
 * Regression tests for the M3 adapter's HTTP error path.
 *
 * The bug these lock down: `fetchJson` used to read `.detail` straight off
 * `await response.json().catch(() => ({}))`. `.catch()` only covers a parse
 * REJECTION — it does not cover a body that parses to `null`. So a non-ok
 * response with a `null` body (a proxy 502, a dead upstream, an empty JSON
 * document) threw `TypeError: null is not an object` and the real HTTP status
 * was lost. Found by running `scripts/probe_m3_seam.ts` with the server down.
 *
 * Every case below must surface a readable `Error` naming the failure, and must
 * never leak a `TypeError`.
 */

/** Builds a minimal `Response`-like stub; jsdom has no real fetch. */
function respond(status: number, body: string, ok = false): Response {
  return {
    ok,
    status,
    json: (): Promise<unknown> =>
      body === ''
        ? Promise.reject(new SyntaxError('Unexpected end of JSON input'))
        : Promise.resolve(JSON.parse(body)),
  } as unknown as Response;
}

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((): Promise<Response> => Promise.resolve(response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('m3Backend HTTP error handling', () => {
  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('surfaces the server detail message when the error body is a JSON object', async () => {
    stubFetch(respond(409, JSON.stringify({ detail: 'Auction already settled' })));

    await expect(fetchHealth()).rejects.toThrow('Auction already settled');
  });

  it('falls back to the status line when the error body parses to null', async () => {
    stubFetch(respond(502, 'null'));

    // The regression: this used to throw `TypeError: null is not an object`.
    await expect(fetchHealth()).rejects.toThrow('/api/health failed: 502');
    await expect(fetchHealth()).rejects.not.toThrow(TypeError);
  });

  it('falls back to the status line when the error body is an array', async () => {
    stubFetch(respond(500, '[]'));

    await expect(fetchHealth()).rejects.toThrow('/api/health failed: 500');
  });

  it('falls back to the status line when the error body is an empty document', async () => {
    stubFetch(respond(503, ''));

    await expect(fetchHealth()).rejects.toThrow('/api/health failed: 503');
  });

  it('falls back to the status line when detail is not a string', async () => {
    stubFetch(respond(400, JSON.stringify({ detail: { nested: true } })));

    await expect(fetchHealth()).rejects.toThrow('/api/health failed: 400');
  });

  it('names the endpoint that failed for a POST as well as a GET', async () => {
    stubFetch(respond(404, 'null'));

    await expect(submitTx('AUCTION_BID', {})).rejects.toThrow('/chain/tx failed: 404');
  });

  it('returns the parsed body on a successful response', async () => {
    stubFetch(
      respond(200, JSON.stringify({ status: 'ok', chainHeight: 9, chainValid: true, auctions: 2, approvals: 3, wallets: 3 }), true),
    );

    await expect(fetchHealth()).resolves.toMatchObject({ status: 'ok', chainHeight: 9, chainValid: true });
  });
});

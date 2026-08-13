import axios from 'axios';
import * as dns from 'node:dns';
import { readUrlSafely } from './ssrf-safe-http-reader.util';

jest.mock('axios');
jest.mock('node:dns');

describe('readUrlSafely', () => {
  afterEach(() => jest.clearAllMocks());

  it('fetches the URL when DNS resolves to a public address', async () => {
    (dns.lookup as unknown as jest.Mock).mockImplementation(
      (_host, _opts, cb) => cb(null, '93.184.216.34', 4),
    );
    (axios.get as jest.Mock).mockImplementation(async (_url, config) => {
      config.lookup('example.com', {}, () => {});
      return { data: new TextEncoder().encode('ok').buffer };
    });

    const result = await readUrlSafely('http://example.com/spec.json');

    expect(result.toString()).toBe('ok');
  });

  it('rejects when DNS resolves to a private/internal address (SSRF guard)', async () => {
    (dns.lookup as unknown as jest.Mock).mockImplementation(
      (_host, _opts, cb) => cb(null, '169.254.169.254', 4),
    );
    (axios.get as jest.Mock).mockImplementation(async (_url, config) => {
      return new Promise((_resolve, reject) => {
        config.lookup('example.com', {}, (err: Error) => reject(err));
      });
    });

    await expect(readUrlSafely('http://example.com/spec.json')).rejects.toThrow(
      /SSRF blocked/,
    );
  });

  it('rejects a redirect hop whose Location is a literal internal IP', async () => {
    // Node skips the `lookup` option entirely when the host is already a literal IP,
    // so this hop can only be caught via beforeRedirect, not safeLookup.
    (axios.get as jest.Mock).mockImplementation(async (_url, config) => {
      config.beforeRedirect(
        { hostname: '169.254.169.254' },
        {} as any,
        {} as any,
      );
      return { data: new ArrayBuffer(0) };
    });

    await expect(readUrlSafely('http://example.com/spec.json')).rejects.toThrow(
      /SSRF blocked/,
    );
  });

  it('rejects when the initial URL itself is a literal internal IP', async () => {
    await expect(readUrlSafely('http://127.0.0.1/spec.json')).rejects.toThrow(
      /SSRF blocked/,
    );
    expect(axios.get).not.toHaveBeenCalled();
  });
});

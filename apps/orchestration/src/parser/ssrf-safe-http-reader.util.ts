import axios, { AddressFamily, LookupAddress } from 'axios';
import * as dns from 'node:dns';
import * as ipaddr from 'ipaddr.js';

// Cùng convention chặn SSRF với LinkScraperService (apps/message/src/service/link-scraper.service.ts):
// validate ở tầng DNS lookup, không phải tầng URL — áp dụng được cho MỌI redirect hop.
const UNSAFE_RANGES = [
  'private',
  'loopback',
  'linkLocal',
  'uniqueLocal',
  'unspecified',
];

function assertIpIsSafe(ip: string, hostname: string): void {
  if (UNSAFE_RANGES.includes(ipaddr.parse(ip).range())) {
    throw new Error(
      `SSRF blocked: refusing to connect to private address ${ip} (host ${hostname})`,
    );
  }
}

// Node bỏ qua `lookup` hoàn toàn khi hostname VỐN ĐÃ là địa chỉ IP (không có gì để
// "lookup") — nên literal IP (VD redirect Location: http://169.254.169.254/...) phải
// được chặn riêng ở đây, trước khi có cơ hội kết nối.
function assertHostnameIsSafe(hostname: string): void {
  if (ipaddr.isValid(hostname)) assertIpIsSafe(hostname, hostname);
}

function toAxiosLookupAddress(
  address: string | dns.LookupAddress[],
): LookupAddress | LookupAddress[] {
  if (typeof address === 'string') return address;
  return address.map((a) => ({
    address: a.address,
    family: a.family as AddressFamily,
  }));
}

// Chặn DNS-rebinding: hostname là tên miền hợp lệ, nhưng bản thân domain đó (hoặc
// bị đổi trỏ sau này) resolve ra IP nội bộ.
function safeLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    err: Error | null,
    address: LookupAddress | LookupAddress[],
    family?: AddressFamily,
  ) => void,
): void {
  dns.lookup(hostname, options, (err, address, family) => {
    const resolved = toAxiosLookupAddress(address);
    if (err) return callback(err, resolved, family as AddressFamily);

    try {
      const addresses = Array.isArray(address)
        ? address.map((a) => a.address)
        : [address];
      addresses.forEach((addr) => assertIpIsSafe(addr, hostname));
      callback(null, resolved, family as AddressFamily);
    } catch (blockErr) {
      callback(blockErr as Error, resolved, family as AddressFamily);
    }
  });
}

// Thay cho HTTP resolver mặc định của SwaggerParser — resolver gốc chỉ validate URL đầu
// (qua canRead), rồi tự follow redirect (mặc định tối đa 5 hop) mà KHÔNG re-validate, nên
// spec host ở URL công khai có thể 302 sang địa chỉ nội bộ (VD cloud metadata) và vẫn được
// fetch. Validate lại ở CẢ initial request lẫn từng redirect hop (beforeRedirect), theo
// đúng 2 dạng host có thể gặp: literal IP (assertHostnameIsSafe) và domain (safeLookup).
export async function readUrlSafely(url: string): Promise<Buffer> {
  assertHostnameIsSafe(new URL(url).hostname);

  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 10_000,
    maxRedirects: 5,
    maxContentLength: 10 * 1024 * 1024,
    lookup: safeLookup,
    beforeRedirect: (redirectOptions) =>
      assertHostnameIsSafe(redirectOptions.hostname),
  });
  return Buffer.from(response.data);
}

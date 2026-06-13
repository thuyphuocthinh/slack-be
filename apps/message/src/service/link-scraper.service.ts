import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import * as dns from 'node:dns';
import * as ipaddr from 'ipaddr.js';
import { ILinkPreviewMetadata } from '../types/link-preview.interface';

@Injectable()
export class LinkScraperService {
  private readonly logger = new Logger(LinkScraperService.name);

  private readonly UNSAFE_RANGES: string[] = [
    'private',
    'loopback',
    'linkLocal',
    'uniqueLocal',
    'unspecified',
  ];

  async scrape(targetUrl: string): Promise<ILinkPreviewMetadata | null> {
    this.logger.log(`Starting scrape for target URL: ${targetUrl}`);
    try {
      const url = new URL(targetUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        this.logger.warn(`Rejected invalid protocol: ${url.protocol} for URL: ${targetUrl}`);
        return null;
      }

      const response: AxiosResponse<string> = await axios.get(targetUrl, {
        timeout: 4000,
        maxRedirects: 3,
        maxContentLength: 2 * 1024 * 1024,
        headers: {
          'User-Agent': 'SlackClone-LinkPreviewScraper/1.0 (+https://tpt.io.vn)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
        },
        lookup: (
          hostname: string,
          options: dns.LookupOptions,
          callback: (
            err: Error | null,
            address: import('axios').LookupAddress | import('axios').LookupAddress[],
            family?: 4 | 6,
          ) => void,
        ) => {
          dns.lookup(hostname, options, (err, address, family) => {
            const resolvedAddressObj: import('axios').LookupAddress | import('axios').LookupAddress[] =
              typeof address === 'string'
                ? { address, family: family as 4 | 6 }
                : address.map((a) => ({ address: a.address, family: a.family as 4 | 6 }));

            if (err) {
              this.logger.warn(`DNS lookup failed for hostname: ${hostname}. Error: ${err.message}`);
              return callback(err, resolvedAddressObj, family as 4 | 6);
            }

            try {
              const addressesToCheck = Array.isArray(resolvedAddressObj)
                ? resolvedAddressObj.map((a) => (typeof a === 'string' ? a : a.address))
                : [typeof resolvedAddressObj === 'string' ? resolvedAddressObj : resolvedAddressObj.address];

              for (const addr of addressesToCheck) {
                const parsedIp = ipaddr.parse(addr);
                const range = parsedIp.range();

                if (this.UNSAFE_RANGES.includes(range)) {
                  this.logger.warn(`SSRF Blocked: Connection to private range ${addr} for host ${hostname} is forbidden.`);
                  return callback(
                    new Error(`SSRF Blocked: Connection to private range ${addr} is forbidden.`),
                    resolvedAddressObj,
                    family as 4 | 6,
                  );
                }
              }
              callback(null, resolvedAddressObj, family as 4 | 6);
            } catch (ipErr) {
              this.logger.error(`IP validation error for address ${JSON.stringify(resolvedAddressObj)}: ${(ipErr as Error).message}`);
              callback(new Error('Invalid IP address resolved'), resolvedAddressObj, family as 4 | 6);
            }
          });
        },
      });

      const contentType = response.headers['content-type'] || '';
      if (typeof contentType === 'string' && !contentType.includes('text/html')) {
        this.logger.warn(`Scraped URL ${targetUrl} returned non-html content type: ${contentType}`);
        return null;
      }

      const meta = this.parseHtml(targetUrl, response.data);
      this.logger.log(`Successfully parsed metadata for ${targetUrl}: title="${meta.title}", image="${meta.imageUrl}"`);
      return meta;
    } catch (error) {
      this.logger.warn(`Failed to scrape link preview for ${targetUrl}: ${(error as Error).message}`);
      return null;
    }
  }

  private parseHtml(url: string, html: string): ILinkPreviewMetadata {
    const $ = cheerio.load(html);

    const title =
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('title').text() ||
      '';

    const description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="twitter:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      '';

    let imageUrl =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      '';

    if (imageUrl && !imageUrl.startsWith('http')) {
      try {
        imageUrl = new URL(imageUrl, url).toString();
      } catch {
        imageUrl = '';
      }
    }

    const siteName =
      $('meta[property="og:site_name"]').attr('content') ||
      new URL(url).hostname;

    let favIcon =
      $('link[rel="apple-touch-icon"]').attr('href') ||
      $('link[rel="icon"]').attr('href') ||
      $('link[rel="shortcut icon"]').attr('href') ||
      '/favicon.ico';

    if (favIcon && !favIcon.startsWith('http')) {
      try {
        favIcon = new URL(favIcon, url).toString();
      } catch {
        favIcon = '';
      }
    }

    const mediaType = $('meta[property="og:type"]').attr('content') || 'website';

    return {
      url,
      title: title.trim().substring(0, 150) || undefined,
      description: description.trim().substring(0, 300) || undefined,
      imageUrl: imageUrl || undefined,
      siteName: siteName.trim() || undefined,
      favIcon: favIcon || undefined,
      mediaType: mediaType || undefined,
    };
  }
}

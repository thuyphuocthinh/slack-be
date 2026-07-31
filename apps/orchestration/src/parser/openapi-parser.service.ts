import { Injectable, Logger } from '@nestjs/common';
import SwaggerParser from '@apidevtools/swagger-parser';
import { OpenAPI } from 'openapi-types';
import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import { readUrlSafely } from './ssrf-safe-http-reader.util';

@Injectable()
export class OpenApiParserService {
  private readonly logger = new Logger(OpenApiParserService.name);

  /**
   * Loads and parses an OpenAPI specification from a URL or local path.
   * Resolves all $ref references automatically.
   *
   * @param urlOrPath The URL or local file path to the OpenAPI/Swagger definition.
   * @returns A fully resolved OpenAPI document.
   */
  async loadSpec(urlOrPath: string): Promise<OpenAPI.Document> {
    try {
      this.logger.debug(`Loading and parsing OpenAPI spec from: ${urlOrPath}`);
      // dereference() reads the spec and replaces all $refs with actual objects.
      // Override the built-in HTTP resolver's `read` so every request — including
      // redirect hops SwaggerParser follows internally — goes through readUrlSafely's
      // DNS-level SSRF guard, instead of only the initial URL being checked.
      const api = await SwaggerParser.dereference(urlOrPath, {
        resolve: { http: { read: (file) => readUrlSafely(file.url) } },
      });
      this.logger.log(
        `Successfully parsed OpenAPI spec: ${api.info?.title || 'Unknown Title'} (Version: ${api.info?.version || 'Unknown'})`,
      );
      return api;
    } catch (error: any) {
      this.logger.error(
        `Failed to parse OpenAPI spec from ${urlOrPath}: ${error.message}`,
        error.stack,
      );
      throw new RpcException({
        ...ORCHESTRATION_ERROR.INVALID_OPENAPI_SPEC,
        details: error.message,
      });
    }
  }
}

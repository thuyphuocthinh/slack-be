import { OpenAPI, OpenAPIV2, OpenAPIV3 } from 'openapi-types';
import { McpToolDto } from '../dto/mcp.dto';
import {
  iterateOperations,
  deriveToolName,
  buildStrictInputSchema,
  deriveMethodAnnotations,
  DynamicToolDefinition,
} from '../common/agentic-openapi-parser';

type AnyOperation = OpenAPIV3.OperationObject & Partial<OpenAPIV2.OperationObject>;

export class OpenApiConverter {
  /**
   * Converts a fully resolved OpenAPI document into a list of MCP Tools.
   *
   * Delegates the actual walk/name-derivation/strict-schema-sanitization to
   * agentic-openapi-parser (extracted from this exact class) — only the Swagger v2
   * `in: 'body'` parameter handling stays here since the library's `buildStrictInputSchema`
   * doesn't fold that case into `requestBody` on its own.
   *
   * @param document The dereferenced OpenAPI document.
   * @returns Array of McpToolDto.
   */
  static convertToMcpTools(document: OpenAPI.Document): McpToolDto[] {
    const tools: McpToolDto[] = [];
    const spec = document as unknown as Record<string, unknown>;

    for (const { path, method, operation } of iterateOperations(spec)) {
      const op = operation as unknown as AnyOperation;

      const name = deriveToolName(method, path, op.operationId);
      const description =
        op.summary || op.description || `Make a ${method.toUpperCase()} request to ${path}`;

      const { parameters, requestBodySchema, requestBodyRequired } = this.extractParamsAndBody(op);

      const toolDef: DynamicToolDefinition = {
        name,
        description,
        method,
        url: path,
        parameters,
        requestBodySchema,
        requestBodyRequired,
      };

      tools.push({
        name,
        description,
        inputSchema: buildStrictInputSchema(toolDef),
        annotations: deriveMethodAnnotations(method),
      });
    }

    return tools;
  }

  private static extractParamsAndBody(operation: AnyOperation): {
    parameters: Record<string, unknown>[];
    requestBodySchema?: Record<string, unknown>;
    requestBodyRequired?: boolean;
  } {
    const allParams = (operation.parameters as Record<string, unknown>[] | undefined) || [];

    // Swagger v2 models the request body as a `parameters` entry with `in: 'body'` — pull it out
    // separately so it becomes a `requestBody` property instead of a same-named parameter.
    const bodyParam = allParams.find((p) => p.in === 'body');
    const parameters = bodyParam ? allParams.filter((p) => p !== bodyParam) : allParams;

    const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined;
    if (requestBody?.content?.['application/json']) {
      return {
        parameters,
        requestBodySchema: {
          ...(requestBody.content['application/json'].schema as object),
          description: requestBody.description || 'Payload for the request',
        },
        requestBodyRequired: requestBody.required,
      };
    }

    if (bodyParam?.schema) {
      return {
        parameters,
        requestBodySchema: {
          ...(bodyParam.schema as object),
          description: (bodyParam.description as string) || 'Payload for the request',
        },
        requestBodyRequired: bodyParam.required as boolean | undefined,
      };
    }

    return { parameters };
  }
}

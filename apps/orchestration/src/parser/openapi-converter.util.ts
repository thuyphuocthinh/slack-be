import { OpenAPI, OpenAPIV2, OpenAPIV3 } from 'openapi-types';
import { McpToolDto } from '../dto/mcp.dto';

export class OpenApiConverter {
  /**
   * Converts a fully resolved OpenAPI document into a list of MCP Tools.
   *
   * @param document The dereferenced OpenAPI document.
   * @returns Array of McpToolDto.
   */
  static convertToMcpTools(document: OpenAPI.Document): McpToolDto[] {
    const tools: McpToolDto[] = [];
    const paths =
      (document as OpenAPIV3.Document).paths ||
      (document as OpenAPIV2.Document).paths;

    if (!paths) return tools;

    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem) continue;

      const methods = [
        'get',
        'post',
        'put',
        'delete',
        'patch',
        'options',
        'head',
      ] as const;
      
      for (const method of methods) {
        const operation = pathItem[method] as
          | OpenAPIV3.OperationObject
          | OpenAPIV2.OperationObject;
        if (!operation) continue;

        tools.push(this.buildMcpTool(path, method, operation));
      }
    }
    return tools;
  }

  private static buildMcpTool(
    path: string,
    method: string,
    operation: OpenAPIV3.OperationObject | OpenAPIV2.OperationObject,
  ): McpToolDto {
    // Generate name: Use operationId if available, otherwise generate from method + path
    const rawName =
      operation.operationId || `${method}_${path.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    // MCP tool name must match ^[a-zA-Z0-9_-]{1,64}$
    const name =
      rawName
        .replace(/[^a-zA-Z0-9_-]/g, '_') // Replace invalid chars with _
        .replace(/_+/g, '_') // Collapse multiple underscores into one
        .substring(0, 64)
        .replace(/^_+|_+$/g, '') || 'unknown_tool';

    const description =
      operation.summary ||
      operation.description ||
      `Make a ${method.toUpperCase()} request to ${path}`;

    const inputSchema = this.buildInputSchema(operation);

    // Annotations for Risk Gate: GET/HEAD/OPTIONS are read-only, others are potentially destructive
    const isReadOnly = ['get', 'head', 'options'].includes(
      method.toLowerCase(),
    );

    return {
      name,
      description,
      inputSchema,
      annotations: {
        readOnlyHint: isReadOnly,
        destructiveHint: !isReadOnly,
      },
    };
  }

  private static buildInputSchema(
    operation: OpenAPIV3.OperationObject | OpenAPIV2.OperationObject,
  ): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    // Parse parameters (path, query, header) - flatten them for LLM simplicity
    if (operation.parameters && Array.isArray(operation.parameters)) {
      for (const param of operation.parameters) {
        // Because the document is dereferenced, param is a ParameterObject, not a ReferenceObject
        const p = param as OpenAPIV3.ParameterObject;
        
        // Some v2 specs might have 'type' directly on the parameter object
        const schema = p.schema || { type: (p as any).type || 'string' };

        // Skip common auth headers as they should be handled by the Executor/HTTP Client globally
        if (
          p.in === 'header' &&
          ['authorization', 'bearer', 'cookie'].includes(p.name.toLowerCase())
        ) {
          continue;
        }

        properties[p.name] = {
          ...schema,
          description: p.description,
        };

        if (p.required) {
          required.push(p.name);
        }
      }
    }

    // Parse request body
    const requestBody = (operation as OpenAPIV3.OperationObject)
      .requestBody as OpenAPIV3.RequestBodyObject;

    if (
      requestBody &&
      requestBody.content &&
      requestBody.content['application/json']
    ) {
      // Put the entire body schema into a 'requestBody' property
      properties.requestBody = {
        ...(requestBody.content['application/json'].schema as object),
        description: requestBody.description || 'Payload for the request',
      };
      if (requestBody.required) {
        required.push('requestBody');
      }
    } else if ((operation as OpenAPIV2.OperationObject).parameters) {
      // Fallback for Swagger v2 body parameters
      const bodyParam = (operation as OpenAPIV2.OperationObject).parameters?.find(
        (p) => (p as any).in === 'body',
      ) as any;
      if (bodyParam && bodyParam.schema) {
        properties.requestBody = {
          ...bodyParam.schema,
          description: bodyParam.description || 'Payload for the request',
        };
        if (bodyParam.required) {
          required.push('requestBody');
        }
      }
    }

    const schemaObj: Record<string, unknown> = {
      type: 'object',
      properties,
    };

    if (required.length > 0) {
      schemaObj.required = required;
    }

    return schemaObj;
  }
}

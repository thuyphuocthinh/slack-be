import { OpenAPI, OpenAPIV2, OpenAPIV3 } from 'openapi-types';
import { McpToolDto } from '../dto/mcp.dto';
import { StrictJsonObject, StrictJsonArray, StrictJsonValue } from '@slack/common';

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
  ): StrictJsonObject {
    const properties: StrictJsonObject = {};
    const required: string[] = [];

    // Parse parameters (path, query, header) - flatten them for LLM simplicity
    if (operation.parameters && Array.isArray(operation.parameters)) {
      for (const param of operation.parameters) {
        // Because the document is dereferenced, param is a ParameterObject, not a ReferenceObject
        const p = param as OpenAPIV3.ParameterObject & { type?: string };
        
        const rawType = p.type || 'string';
        const schema = p.schema || { type: rawType === 'file' ? 'string' : rawType };

        // Skip common auth headers as they should be handled by the Executor/HTTP Client globally
        if (
          p.in === 'header' &&
          ['authorization', 'bearer', 'cookie'].includes(p.name.toLowerCase())
        ) {
          continue;
        }

        const paramSchema = { ...(schema as object) } as StrictJsonObject;
        if (p.description) {
          paramSchema['description'] = String(p.description);
        }

        properties[p.name] = this.sanitizeJsonSchema(paramSchema);

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
      properties['requestBody'] = this.sanitizeJsonSchema({
        ...(requestBody.content['application/json'].schema as object),
        description: requestBody.description || 'Payload for the request',
      } as StrictJsonObject);
      if (requestBody.required) {
        required.push('requestBody');
      }
    } else if ((operation as OpenAPIV2.OperationObject).parameters) {
      // Fallback for Swagger v2 body parameters
      const bodyParam = (operation as OpenAPIV2.OperationObject).parameters?.find(
        (p) => (p as OpenAPIV2.ParameterObject).in === 'body',
      ) as OpenAPIV2.ParameterObject | undefined;
      
      if (bodyParam && bodyParam.schema) {
        properties['requestBody'] = this.sanitizeJsonSchema({
          ...(bodyParam.schema as object),
          description: bodyParam.description || 'Payload for the request',
        } as StrictJsonObject);
        if (bodyParam.required) {
          required.push('requestBody');
        }
      }
    }

    const schemaObj: StrictJsonObject = {
      type: 'object',
      properties,
    };

    if (required.length > 0) {
      schemaObj.required = required;
    }

    return schemaObj;
  }

  private static sanitizeJsonSchema(schema: StrictJsonValue): StrictJsonValue {
    if (!schema || typeof schema !== 'object') return schema;

    if (Array.isArray(schema)) {
      return schema.map((item) => this.sanitizeJsonSchema(item)) as StrictJsonArray;
    }

    const result: StrictJsonObject = { ...(schema as StrictJsonObject) };

    // OpenAI API strict JSON Schema only supports standard types.
    if (result['type'] === 'file') {
      result['type'] = 'string';
      const desc = result['description'];
      result['description'] = desc && typeof desc === 'string'
        ? `${desc} (Base64 Encoded Binary Data)`
        : 'Base64 Encoded Binary Data';
      // Do not use format: 'binary' because strict mode often rejects unsupported string formats.
      delete result['format'];
    }

    // Strip keys that cause issues in OpenAI Strict Mode
    delete result['default'];
    delete result['example'];
    delete result['examples'];
    delete result['pattern'];
    delete result['minLength'];
    delete result['maxLength'];
    delete result['minimum'];
    delete result['maximum'];
    
    // Remove any explicit null values as OpenAI strict JSON schema parser complains "None is not of type ..."
    for (const key of Object.keys(result)) {
      if (result[key] === null) {
        delete result[key];
      }
    }

    if (result['properties'] && typeof result['properties'] === 'object' && !Array.isArray(result['properties'])) {
      const props = result['properties'] as StrictJsonObject;
      for (const [key, val] of Object.entries(props)) {
        props[key] = this.sanitizeJsonSchema(val);
      }
    }

    if (result['items']) {
      result['items'] = this.sanitizeJsonSchema(result['items']);
    }

    return result;
  }
}

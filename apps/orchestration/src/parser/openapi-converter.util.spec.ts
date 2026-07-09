import { OpenApiConverter } from './openapi-converter.util';
import { OpenAPIV3 } from 'openapi-types';

describe('OpenApiConverter', () => {
  describe('convertToMcpTools', () => {
    it('should convert a basic OpenAPI v3 document to MCP tools', () => {
      const mockDoc: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/users': {
            get: {
              operationId: 'getUsers',
              summary: 'Get a list of users',
              parameters: [
                {
                  name: 'page',
                  in: 'query',
                  required: false,
                  schema: { type: 'number' },
                  description: 'Page number',
                },
              ],
              responses: { '200': { description: 'Success' } },
            },
            post: {
              summary: 'Create a user',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { name: { type: 'string' } },
                    },
                  },
                },
              },
              responses: { '201': { description: 'Created' } },
            },
          },
        },
      };

      const tools = OpenApiConverter.convertToMcpTools(mockDoc);

      expect(tools).toHaveLength(2);

      // Check GET tool
      const getTool = tools.find((t) => t.name === 'getUsers');
      expect(getTool).toBeDefined();
      expect(getTool?.description).toBe('Get a list of users');
      expect(getTool?.annotations?.readOnlyHint).toBe(true);
      expect(getTool?.annotations?.destructiveHint).toBe(false);
      expect((getTool?.inputSchema as any).properties).toHaveProperty('page');
      expect(((getTool?.inputSchema as any).properties as any).page.type).toBe('number');

      // Check POST tool (fallback name generation since no operationId)
      const postTool = tools.find((t) => t.name === 'post_users');
      expect(postTool).toBeDefined();
      expect(postTool?.description).toBe('Create a user');
      expect(postTool?.annotations?.readOnlyHint).toBe(false);
      expect(postTool?.annotations?.destructiveHint).toBe(true);
      expect((postTool?.inputSchema as any).properties).toHaveProperty('requestBody');
      expect(((postTool?.inputSchema as any).required as string[])).toContain('requestBody');
    });

    it('should ignore authorization headers', () => {
      const mockDoc: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Auth API', version: '1.0.0' },
        paths: {
          '/secure': {
            get: {
              operationId: 'getSecureData',
              parameters: [
                {
                  name: 'Authorization',
                  in: 'header',
                  required: true,
                  schema: { type: 'string' },
                },
                {
                  name: 'id',
                  in: 'query',
                  required: true,
                  schema: { type: 'string' },
                },
              ],
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      };

      const tools = OpenApiConverter.convertToMcpTools(mockDoc);
      const tool = tools[0];

      expect((tool.inputSchema as any).properties).not.toHaveProperty('Authorization');
      expect((tool.inputSchema as any).properties).toHaveProperty('id');
      expect(((tool.inputSchema as any).required as string[])).not.toContain('Authorization');
      expect(((tool.inputSchema as any).required as string[])).toContain('id');
    });

    it('should correctly parse path parameters', () => {
      const mockDoc: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: {
          '/users/{userId}/posts/{postId}': {
            get: {
              operationId: 'getUserPost',
              parameters: [
                { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
                { name: 'postId', in: 'path', required: true, schema: { type: 'number' } },
              ],
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      };

      const tools = OpenApiConverter.convertToMcpTools(mockDoc);
      expect(tools).toHaveLength(1);

      const schema = tools[0].inputSchema as any;
      expect(schema.properties).toHaveProperty('userId');
      expect(schema.properties).toHaveProperty('postId');
      expect(schema.required).toContain('userId');
      expect(schema.required).toContain('postId');
    });

    it('should parse OpenAPI V2 (Swagger) body parameters', () => {
      const mockDoc: any = {
        swagger: '2.0',
        info: { title: 'V2 API', version: '1.0.0' },
        paths: {
          '/items': {
            post: {
              operationId: 'createItem',
              parameters: [
                {
                  name: 'body',
                  in: 'body',
                  required: true,
                  schema: { type: 'object', properties: { price: { type: 'number' } } },
                  description: 'Item payload',
                },
              ],
              responses: { '201': { description: 'Created' } },
            },
          },
        },
      };

      const tools = OpenApiConverter.convertToMcpTools(mockDoc);
      expect(tools).toHaveLength(1);

      const schema = tools[0].inputSchema as any;
      expect(schema.properties).toHaveProperty('requestBody');
      const requestBody: any = schema.properties['requestBody'];
      expect(requestBody.type).toBe('object');
      expect(requestBody.properties.price.type).toBe('number');
      expect(schema.required).toContain('requestBody');
    });

    it('should sanitize operation names correctly to match MCP standards', () => {
      const mockDoc: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Sanitize API', version: '1.0.0' },
        paths: {
          '/test-path/!@#$/%^&*': {
            get: {
              responses: { '200': { description: 'Success' } },
            },
          },
          '/another': {
            put: {
              operationId: 'invalid-name!@#',
              responses: { '200': { description: 'Success' } },
            },
          },
        },
      };

      const tools = OpenApiConverter.convertToMcpTools(mockDoc);
      expect(tools).toHaveLength(2);

      const getTool = tools.find(t => t.name.startsWith('get_test_path'));
      expect(getTool).toBeDefined();
      expect(getTool?.name).toMatch(/^[a-zA-Z0-9_-]+$/);

      const putTool = tools.find(t => t.name.startsWith('invalid-name'));
      expect(putTool).toBeDefined();
      expect(putTool?.name).toBe('invalid-name');
    });

    it('should handle undefined or empty paths gracefully', () => {
      const mockDoc: OpenAPIV3.Document = {
        openapi: '3.0.0',
        info: { title: 'Empty API', version: '1.0.0' },
        paths: {},
      };

      let tools = OpenApiConverter.convertToMcpTools(mockDoc);
      expect(tools).toHaveLength(0);

      const mockDocUndefinedPaths = {
        openapi: '3.0.0',
        info: { title: 'Empty API', version: '1.0.0' },
      } as unknown as OpenAPIV3.Document;

      tools = OpenApiConverter.convertToMcpTools(mockDocUndefinedPaths);
      expect(tools).toHaveLength(0);
    });
  });
});

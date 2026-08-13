type JsonSchemaNode = Record<string, any>;

function nullable(node: JsonSchemaNode): JsonSchemaNode {
  const type = Array.isArray(node.type) ? node.type : [node.type];
  return { ...node, type: [...type, 'null'] };
}

function strictify(node: JsonSchemaNode): JsonSchemaNode {
  if (node.type === 'array' && node.items) {
    return { ...node, items: strictify(node.items) };
  }
  if (node.type !== 'object' || !node.properties) {
    return node;
  }

  const required: string[] = node.required ?? [];
  const properties = Object.fromEntries(
    Object.entries(node.properties).map(([key, value]) => {
      const strictValue = strictify(value as JsonSchemaNode);
      return [
        key,
        required.includes(key) ? strictValue : nullable(strictValue),
      ];
    }),
  );

  return {
    ...node,
    properties,
    required: Object.keys(node.properties),
    additionalProperties: false,
  };
}

/**
 * OpenAI Structured Outputs `strict: true` chỉ đảm bảo output khớp 100%
 * schema (constrained decoding) khi MỌI field đều nằm trong `required` và mọi
 * object có `additionalProperties: false`. Field vốn "tuỳ chọn" trong schema
 * dùng chung 3 provider được chuyển thành bắt buộc-nhưng-nullable, để hành vi
 * chức năng (field có thể vắng mặt) không đổi.
 */
export function toOpenAiStrictSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return strictify(schema);
}

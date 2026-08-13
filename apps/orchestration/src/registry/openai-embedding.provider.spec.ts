const mockCreate = jest.fn();

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    embeddings: { create: mockCreate },
  }));
});

import { OpenAiEmbeddingProvider } from './openai-embedding.provider';

describe('OpenAiEmbeddingProvider', () => {
  const originalApiKey = process.env.OPENAI_EMBEDDING_API_KEY;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalApiKey === undefined)
      delete process.env.OPENAI_EMBEDDING_API_KEY;
    else process.env.OPENAI_EMBEDDING_API_KEY = originalApiKey;
  });

  it('embeds a batch of texts, returning one vector per input in order', async () => {
    process.env.OPENAI_EMBEDDING_API_KEY = 'test-key';
    mockCreate.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
    });
    const provider = new OpenAiEmbeddingProvider();

    const vectors = await provider.embed(['hello', 'world']);

    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['hello', 'world'],
    });
  });

  it('throws instead of calling the API when OPENAI_EMBEDDING_API_KEY is missing', async () => {
    delete process.env.OPENAI_EMBEDDING_API_KEY;
    const provider = new OpenAiEmbeddingProvider();

    await expect(provider.embed(['hello'])).rejects.toThrow(
      'OPENAI_EMBEDDING_API_KEY is not configured',
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

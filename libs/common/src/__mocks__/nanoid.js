// Jest-only CJS shim: nanoid@5 ships ESM-only ("import { webcrypto } from 'node:crypto'"), which
// ts-jest's default transform can't parse when the real package is required transitively (e.g. via
// libs/common/src/utils/string.util.ts). Mapped in via moduleNameMapper (see root package.json),
// not relying on Jest's implicit __mocks__ auto-discovery since `roots` is scoped to apps/+libs/.
module.exports = {
  customAlphabet: () => () => 'mocked-id',
  nanoid: () => 'mocked-id',
};

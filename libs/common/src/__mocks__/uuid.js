// Jest-only CJS shim: uuid@13 ships ESM-only ("export { default as MAX } from './max.js'"), which
// ts-jest's default transform can't parse when required transitively. Mapped in via
// moduleNameMapper (see root package.json). Counter-based so tests relying on distinct ids across
// multiple calls within the same test still behave sanely.
let counter = 0;
module.exports = {
  v4: () => `mocked-uuid-${++counter}`,
  v7: () => `mocked-uuid-v7-${++counter}`,
};

export const regex = {
  password: /^(?=.*[a-z])(?=.*[A-Z]).+$/,
  PII_CREDIT_CARD: /\b(?:\d[ -]*?){13,16}\b/g,
  PII_EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  PII_SSN: /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,
  PII_PHONE: /(?:\+?\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}\b/g,
  PII_JWT: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  PII_PRIVATE_KEY: /-----BEGIN .*?PRIVATE KEY-----[\s\S]*?-----END .*?PRIVATE KEY-----/g,
};

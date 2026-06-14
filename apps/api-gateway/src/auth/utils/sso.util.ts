import * as zlib from 'zlib';

export function generateSamlRequest(entryPoint: string, issuer: string, callbackUrl: string): string {
  const id = '_' + Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
  const instant = new Date().toISOString();
  
  const xml = `<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ` +
    `xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
    `ID="${id}" Version="2.0" IssueInstant="${instant}" ` +
    `AssertionConsumerServiceURL="${callbackUrl}" Destination="${entryPoint}">` +
    `<saml:Issuer>${issuer}</saml:Issuer>` +
    `<samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>` +
    `</samlp:AuthnRequest>`;

  const buffer = zlib.deflateRawSync(Buffer.from(xml));
  return buffer.toString('base64');
}

export function parseSamlEmail(xml: string): string | null {
  // 1. Try NameID (standard SAML Name Identifier)
  const nameIdMatch = xml.match(/<(?:saml2?:)?NameID[^>]*>([^<]+)<\/(?:saml2?:)?NameID>/i);
  if (nameIdMatch && nameIdMatch[1]) {
    const val = nameIdMatch[1].trim();
    if (val.includes('@')) return val;
  }

  // 2. Try Attribute Statement with email attribute name
  const attrRegex = /<(?:saml2?:)?Attribute\s+[^>]*Name="[^"]*email[^"]*"[^>]*>\s*<(?:saml2?:)?AttributeValue[^>]*>([^<]+)<\/(?:saml2?:)?AttributeValue>/i;
  const attrMatch = xml.match(attrRegex);
  if (attrMatch && attrMatch[1]) {
    const val = attrMatch[1].trim();
    if (val.includes('@')) return val;
  }

  // 3. Fallback: scan for any valid email addresses in the XML document
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const emails = xml.match(emailRegex);
  if (emails && emails.length > 0) {
    for (const email of emails) {
      // Exclude strings that look like schema namespace URLs
      const lower = email.toLowerCase();
      if (!lower.includes('schema') && !lower.includes('xml') && !lower.includes('oasis-open')) {
        return email;
      }
    }
  }

  return null;
}

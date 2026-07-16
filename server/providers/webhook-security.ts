import { createHmac, createPublicKey, timingSafeEqual, verify as verifySignature } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";

const googleOidcKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export interface WebhookSecurity {
  verifyTwilio(input: { signature?: string; url: string; fields: Record<string, unknown> }): boolean;
  verifySendGrid(input: { signature?: string; timestamp?: string; rawBody?: Buffer }): boolean;
  verifyGooglePubSub(input: { authorization?: string; audienceUrl: string }): Promise<boolean>;
  twilioConfigured: boolean;
  sendGridConfigured: boolean;
  googlePubSubConfigured: boolean;
}

export interface WebhookSecurityOptions {
  twilioAuthToken?: string;
  sendGridVerificationKey?: string;
  googlePubSubAudience?: string;
  googlePubSubServiceAccount?: string;
}

function safeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function twilioPayload(url: string, fields: Record<string, unknown>) {
  let value = url;
  for (const key of Object.keys(fields).sort()) {
    const field = fields[key];
    const values = Array.isArray(field) ? [...field].map(String).sort() : [String(field ?? "")];
    for (const item of values) value += `${key}${item}`;
  }
  return value;
}

function sendGridPublicKey(value: string) {
  if (value.includes("BEGIN PUBLIC KEY")) return createPublicKey(value);
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 65 && decoded[0] === 4) {
    const p256SpkiPrefix = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex");
    return createPublicKey({ key: Buffer.concat([p256SpkiPrefix, decoded]), format: "der", type: "spki" });
  }
  return createPublicKey({ key: decoded, format: "der", type: "spki" });
}

export function createWebhookSecurity(options: WebhookSecurityOptions): WebhookSecurity {
  return {
    twilioConfigured: Boolean(options.twilioAuthToken),
    sendGridConfigured: Boolean(options.sendGridVerificationKey),
    googlePubSubConfigured: Boolean(options.googlePubSubAudience && options.googlePubSubServiceAccount),

    verifyTwilio(input) {
      if (!options.twilioAuthToken || !input.signature) return false;
      const expected = createHmac("sha1", options.twilioAuthToken)
        .update(twilioPayload(input.url, input.fields), "utf8")
        .digest("base64");
      return safeEqualText(expected, input.signature);
    },

    verifySendGrid(input) {
      if (!options.sendGridVerificationKey || !input.signature || !input.timestamp || !input.rawBody) return false;
      try {
        const signed = Buffer.concat([Buffer.from(input.timestamp, "utf8"), input.rawBody]);
        return verifySignature(
          "sha256",
          signed,
          sendGridPublicKey(options.sendGridVerificationKey),
          Buffer.from(input.signature, "base64"),
        );
      } catch {
        return false;
      }
    },

    async verifyGooglePubSub(input) {
      if (!options.googlePubSubAudience || !options.googlePubSubServiceAccount) return false;
      const token = input.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token || token.length > 8_192) return false;
      try {
        const verified = await jwtVerify(token, googleOidcKeys, {
          audience: options.googlePubSubAudience,
          issuer: ["accounts.google.com", "https://accounts.google.com"],
        });
        const claims = verified.payload as typeof verified.payload & { email?: string; email_verified?: boolean };
        return claims.email === options.googlePubSubServiceAccount
          && claims.email_verified === true
          && input.audienceUrl === options.googlePubSubAudience;
      } catch {
        return false;
      }
    },
  };
}

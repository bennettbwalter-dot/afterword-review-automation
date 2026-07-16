import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;

function deriveScryptKey(
  password: string,
  salt: Buffer,
  length: number,
  options: { N: number; r: number; p: number; maxmem: number },
) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function hashPassword(password: string) {
  if (password.length < 12) throw new Error("Password must contain at least 12 characters.");
  const salt = randomBytes(16);
  const derived = await deriveScryptKey(password.normalize("NFKC"), salt, 64, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELISM,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELISM}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, cost, blockSize, parallelism, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "scrypt" || !cost || !blockSize || !parallelism || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, "base64url");
  const actual = await deriveScryptKey(password.normalize("NFKC"), Buffer.from(saltValue, "base64url"), expected.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelism),
    maxmem: 64 * 1024 * 1024,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string, pepper: string) {
  return createHmac("sha256", pepper).update(token, "utf8").digest();
}

export interface EncryptedField {
  ciphertext: Buffer;
  nonce: Buffer;
  tag: Buffer;
}

function encryptionKey(base64Key: string) {
  const key = Buffer.from(base64Key, "base64url");
  if (key.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

export function encryptField(value: string, base64Key: string, context: string): EncryptedField {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(base64Key), nonce);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag() };
}

export function decryptField(field: EncryptedField, base64Key: string, context: string) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(base64Key), field.nonce);
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(field.tag);
  return Buffer.concat([decipher.update(field.ciphertext), decipher.final()]).toString("utf8");
}

export function hashDestination(value: string, pepper: string) {
  return createHmac("sha256", pepper).update(value.trim().toLowerCase(), "utf8").digest();
}

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

export type BrokerCredentialMap = Record<string, string>;

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;

/** Returns true if the encryption key env var is configured */
export function isEncryptionAvailable(): boolean {
  const key = process.env.BROKER_ENCRYPTION_KEY ?? "";
  return key.length >= 16;
}

/**
 * Derives a 32-byte encryption key from the passphrase using scrypt
 */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LENGTH);
}

/**
 * Encrypts a credential map to a base64 string using AES-256-GCM.
 * Format: base64({salt}:{iv}:{authTag}:{ciphertext})
 * Throws if BROKER_ENCRYPTION_KEY is not set.
 */
export function encryptCredentials(credentials: BrokerCredentialMap): string {
  const key = process.env.BROKER_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error(
      "BROKER_ENCRYPTION_KEY is not set or too short (min 16 chars). " +
        "Add it to environment before storing broker credentials."
    );
  }

  const plaintext = JSON.stringify(credentials);
  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = deriveKey(key, salt);
  const iv = randomBytes(IV_LENGTH);
  
  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: salt:iv:authTag:ciphertext (all base64 encoded, joined by :)
  return [
    salt.toString("base64"),
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64")
  ].join(":");
}

/**
 * Decrypts an encrypted credential string back to a map.
 * Never call this in a context that returns data to the client.
 */
export function decryptCredentials(encrypted: string): BrokerCredentialMap {
  const key = process.env.BROKER_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error("BROKER_ENCRYPTION_KEY is not configured.");
  }

  try {
    const parts = encrypted.split(":");
    if (parts.length !== 4) {
      throw new Error("Invalid encrypted data format");
    }

    const [saltB64, ivB64, authTagB64, ciphertextB64] = parts;
    const salt = Buffer.from(saltB64, "base64");
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(authTagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");

    const derivedKey = deriveKey(key, salt);
    const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString("utf8")) as BrokerCredentialMap;
  } catch (error) {
    throw new Error(`Failed to decrypt broker credentials: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Returns a masked version of a credential value safe to display in the UI.
 * e.g. "eyJh...xyz123" → "••••••••xyz123"
 * Never returns the full value.
 */
export function maskCredential(value: string): string {
  if (!value || value.length === 0) return "";
  if (value.length <= 8) return "••••••••";
  const tail = value.slice(-6);
  return `••••••••${tail}`;
}

/**
 * Returns a safe credential summary — all values masked.
 * Safe to include in API responses.
 */
export function maskCredentialMap(credentials: BrokerCredentialMap): Record<string, string> {
  return Object.fromEntries(
    Object.entries(credentials).map(([k, v]) => [k, maskCredential(v)])
  );
}

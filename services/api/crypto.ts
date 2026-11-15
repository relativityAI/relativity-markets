import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const ALGORITHM = "aes-256-gcm";

/** The AES key: ENCRYPTION_KEY env when set; otherwise auto-generated once at
 *  services/data/encryption.key so a fresh local install needs zero config. */
function getKey(): Buffer {
  if (config.encryptionKey) {
    const buf = Buffer.from(config.encryptionKey, "hex");
    if (buf.length !== 32) throw new Error("ENCRYPTION_KEY must be a 64-char hex string (32 bytes)");
    return buf;
  }
  const file = path.resolve(config.sqlitePath, "..", "encryption.key");
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("hex"), { mode: 0o600 });
    chmodSync(file, 0o600);
  }
  return Buffer.from(readFileSync(file, "utf8").trim(), "hex");
}

export function encrypt(plaintext: string): string {
  const k = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, k, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv(hex):tag(hex):ciphertext(hex)
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Invalid encrypted payload format");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const encrypted = Buffer.from(dataHex, "hex");
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}

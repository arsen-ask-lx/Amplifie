import { createHash, randomBytes } from "node:crypto";

/**
 * Токены доступа: сессия человека, приглашение, код и токен моста.
 *
 * Общий файл, потому что правило одно на всех: **в базе живёт только хеш.**
 * Потерял значение — выпусти новое; это дешевле, чем хранить то, чем можно
 * войти (Р-009).
 */

/** 256 бит — столько же, сколько у сессии: это тоже вход в пространство. */
const TOKEN_BYTES = 32;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

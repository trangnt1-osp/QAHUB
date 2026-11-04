import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { EnvironmentAccountDto } from './environments.dto';

function encryptionKey() {
  const value = process.env.ENVIRONMENT_ACCOUNTS_KEY;
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error('ENVIRONMENT_ACCOUNTS_KEY must be a base64-encoded 32-byte key');
  return Buffer.from(value, 'base64');
}

export function encryptAccounts(accounts: EnvironmentAccountDto[], projectId: bigint) {
  if (!accounts.length) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`environment-accounts:${projectId}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(accounts), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}

export function decryptAccounts(encrypted: string | null, projectId: bigint): EnvironmentAccountDto[] {
  if (!encrypted) return [];
  const [version, iv, tag, ciphertext] = encrypted.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Invalid encrypted environment accounts');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(`environment-accounts:${projectId}`));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}

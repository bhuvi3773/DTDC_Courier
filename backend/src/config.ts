import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_ACCESS_SECRET = 'dev-access-secret-change-me-0000000000';
const DEFAULT_REFRESH_SECRET = 'dev-refresh-secret-change-me-000000000';
const DEFAULT_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigin: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  encryptionKey: string;
  routingStrategy: 'OWN_ONLY' | 'PARTNER_ONLY' | 'AUTO_OPTIMIZED';
}

export const config: AppConfig = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? DEFAULT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? DEFAULT_REFRESH_SECRET,
  encryptionKey: process.env.ENCRYPTION_KEY ?? DEFAULT_ENCRYPTION_KEY,
  // Global routing strategy override. The runtime value is read from
  // PricingConfig ('ROUTING_STRATEGY') when present; this env is the fallback.
  routingStrategy:
    (process.env.ROUTING_STRATEGY as AppConfig['routingStrategy']) ??
    'AUTO_OPTIMIZED',
};

/**
 * Validate critical cryptographic secrets. Throws in production if dev
 * default fallbacks or weak keys are detected.
 */
export function validateProductionSecrets(cfg: AppConfig = config): string[] {
  const issues: string[] = [];
  if (cfg.jwtAccessSecret === DEFAULT_ACCESS_SECRET || cfg.jwtAccessSecret.length < 32) {
    issues.push('JWT_ACCESS_SECRET must be at least 32 characters and not the dev default');
  }
  if (cfg.jwtRefreshSecret === DEFAULT_REFRESH_SECRET || cfg.jwtRefreshSecret.length < 32) {
    issues.push('JWT_REFRESH_SECRET must be at least 32 characters and not the dev default');
  }
  if (cfg.encryptionKey === DEFAULT_ENCRYPTION_KEY || !/^[0-9a-fA-F]{64}$/.test(cfg.encryptionKey)) {
    issues.push('ENCRYPTION_KEY must be a non-default 64-hex-char AES-256 key');
  }
  if (cfg.nodeEnv === 'production' && issues.length > 0) {
    throw new Error(`[security] Refusing production startup: ${issues.join('; ')}`);
  }
  return issues;
}

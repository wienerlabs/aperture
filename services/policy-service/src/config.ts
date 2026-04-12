import dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export const config = {
  port: parseInt(optionalEnv('POLICY_SERVICE_PORT', '3001'), 10),
  nodeEnv: optionalEnv('NODE_ENV', 'development'),
  logLevel: optionalEnv('LOG_LEVEL', 'info'),
  database: {
    host: requireEnv('POSTGRES_HOST'),
    port: parseInt(optionalEnv('POSTGRES_PORT', '5432'), 10),
    user: requireEnv('POSTGRES_USER'),
    password: requireEnv('POSTGRES_PASSWORD'),
    database: requireEnv('POSTGRES_DB'),
  },
  tokens: {
    usdc_mint: requireEnv('USDC_MINT_ADDRESS'),
    usdt_mint: requireEnv('USDT_MINT_ADDRESS'),
  },
  solanaRpcUrl: optionalEnv('SOLANA_RPC_URL', 'https://api.devnet.solana.com'),
  policyRegistryProgram: optionalEnv('POLICY_REGISTRY_PROGRAM', 'Po1icyReg1stryAperture111111111111111111111111'),
} as const;

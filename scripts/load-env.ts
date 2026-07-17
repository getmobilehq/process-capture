/**
 * Load .env for tsx scripts (Next auto-loads it for the app, but plain tsx does
 * not). Import this FIRST, before any module that reads process.env / config.
 */
import { existsSync } from 'node:fs';

if (existsSync('.env')) {
  // Node 20.12+/22: load a dotenv file into process.env.
  (process as NodeJS.Process & { loadEnvFile?: (p: string) => void }).loadEnvFile?.('.env');
}

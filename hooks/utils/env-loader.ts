import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env'), quiet: true });

export const STATE_DIR = process.env.STATE_DIR || './state';

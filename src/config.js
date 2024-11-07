import { promises as fs } from 'fs';
import path from 'path';
import { logger } from './logger.js';

export async function loadConfig() {
  try {
    const userId = await fs.readFile('uid.txt', 'utf8');
    const proxyContent = await fs.readFile('proxy.txt', 'utf8');
    
    const proxies = proxyContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    if (!userId.trim()) {
      throw new Error('User ID cannot be empty');
    }

    logger.info(`Loaded user ID: ${userId.trim()}`);
    logger.info(`Found ${proxies.length} proxies`);

    return {
      userId: userId.trim(),
      proxies: proxies.length ? proxies : [null]
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.error('Required configuration files not found');
      logger.error('Please ensure both uid.txt and proxy.txt exist');
      process.exit(1);
    }
    throw error;
  }
}
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function loadUserId() {
  try {
    const userIdPath = path.join(__dirname, '..', 'uid.txt');
    const userId = await fs.readFile(userIdPath, 'utf-8');
    const trimmedId = userId.trim();
    
    if (!trimmedId) {
      throw new Error('User ID cannot be empty in uid.txt');
    }
    
    logger.info(`Loaded user ID: ${trimmedId}`);
    return trimmedId;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('uid.txt not found. Please create it with your user ID');
    }
    throw error;
  }
}

export async function loadProxies() {
  try {
    const proxyPath = path.join(__dirname, '..', 'proxy.txt');
    const content = await fs.readFile(proxyPath, 'utf-8');
    const proxies = content
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));
    
    logger.info(`Loaded ${proxies.length} proxies`);
    return proxies.length ? proxies : [null];
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.warn('proxy.txt not found, running without proxy');
      return [null];
    }
    throw error;
  }
}
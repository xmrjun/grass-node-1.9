import { GrassClient } from './src/client.js';
import { promises as fs } from 'fs';
import { logger } from './src/logger.js';

async function loadConfig() {
  try {
    const userId = (await fs.readFile('uid.txt', 'utf8')).trim();
    const proxyContent = await fs.readFile('proxy.txt', 'utf8');
    
    const proxies = proxyContent
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'));

    if (!userId) {
      throw new Error('User ID cannot be empty in uid.txt');
    }

    return { userId, proxies: proxies.length ? proxies : [null] };
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Configuration files not found. Please ensure uid.txt and proxy.txt exist.');
    }
    throw error;
  }
}

async function main() {
  try {
    console.clear();
    logger.info('?? Grass Node Starting...\n');

    const { userId, proxies } = await loadConfig();
    logger.info(`Starting ${proxies.length} connection(s)...\n`);
    
    const clients = proxies.map(proxy => new GrassClient(userId, proxy));
    
    // Start clients with a small delay between each
    for (const client of clients) {
      client.start().catch(error => {
        logger.error(`Failed to start client: ${error.message}`);
      });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
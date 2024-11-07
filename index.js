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
    
    // 启动所有客户端并保持运行
    await Promise.all(clients.map(client => client.start()));
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    // 不要退出进程，等待5秒后重试
    await new Promise(resolve => setTimeout(resolve, 5000));
    main();
  }
}

// 捕获未处理的异常，防止程序崩溃
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
});

main();
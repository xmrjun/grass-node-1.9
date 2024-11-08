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

async function startClient() {
  try {
    console.clear();
    logger.info('🌿 Grass Node Starting...\n');

    const { userId, proxies } = await loadConfig();
    logger.info(`Starting ${proxies.length} connection(s)...\n`);
    
    const clients = proxies.map(proxy => new GrassClient(userId, proxy));
    
    // 监控所有客户端连接
    const monitor = setInterval(() => {
      let activeConnections = clients.filter(client => client.isConnected).length;
      logger.info(`Active connections: ${activeConnections}/${clients.length}`);
      
      // 如果有断开的连接，尝试重新连接
      clients.forEach(client => {
        if (!client.isConnected) {
          client.start().catch(() => {});
        }
      });
    }, 30000); // 每30秒检查一次

    // 启动所有客户端
    await Promise.all(clients.map(client => client.start()));

    return monitor;
  } catch (error) {
    logger.error(`Error: ${error.message}`);
    throw error;
  }
}

async function main() {
  let monitor;
  
  const restart = async () => {
    if (monitor) clearInterval(monitor);
    try {
      monitor = await startClient();
    } catch (error) {
      logger.error(`Failed to start clients: ${error.message}`);
      logger.info('Retrying in 30 seconds...');
      setTimeout(restart, 30000);
    }
  };

  // 启动主程序
  await restart();

  // 处理未捕获的异常
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught Exception: ${error.message}`);
    restart();
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
    restart();
  });

  // 优雅退出
  process.on('SIGINT', async () => {
    logger.info('Shutting down gracefully...');
    if (monitor) clearInterval(monitor);
    process.exit(0);
  });
}

main();

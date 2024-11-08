import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import { config } from './config.js';
import { logger } from './logger.js';
import { SecurityManager } from './security.js';
import { ProxyManager } from './proxy-manager.js';

export class GrassClient {
  constructor(userId, proxy = null) {
    this.userId = userId;
    this.proxy = proxy;
    this.browserId = uuidv4();
    this.ws = null;
    this.retryCount = 0;
    this.security = new SecurityManager();
    this.proxyManager = new ProxyManager();
    this.isAuthenticated = false;
  }

  async start() {
    while (this.retryCount < config.MAX_RETRIES) {
      try {
        this.ws = new WebSocket(config.WEBSOCKET_URL, {
          headers: this.getHeaders(),
          proxy: this.proxy,
          handshakeTimeout: config.HANDSHAKE_TIMEOUT
        });

        this.ws.on('error', (error) => {
          logger.error(`WebSocket error: ${error.message}`);
        });

        await new Promise((resolve, reject) => {
          this.ws.once('open', resolve);
          this.ws.once('error', reject);
        });

        if (await this.authenticate()) {
          this.retryCount = 0;
          await this.handleHeartbeat();
        }
      } catch (error) {
        this.retryCount++;
        logger.error(
          `Connection error (attempt ${this.retryCount}/${config.MAX_RETRIES}): ${error.message}`
        );
        await new Promise(resolve => setTimeout(resolve, config.RECONNECT_DELAYS[
          Math.min(this.retryCount - 1, config.RECONNECT_DELAYS.length - 1)
        ]));
      } finally {
        if (this.ws) {
          this.ws.close();
          this.isAuthenticated = false;
        }
      }
    }
  }

  getHeaders() {
    return {
      'Host': 'proxy2.wynd.network:4650',
      'Connection': 'Upgrade',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Grass/1.0.0 Chrome/114.0.5735.289 Electron/25.8.1 Safari/537.36',
      'Upgrade': 'websocket',
      'Origin': 'https://app.getgrass.io',
      'Sec-WebSocket-Version': '13',
      'Accept-Language': 'en-US,en;q=0.9'
    };
  }

  async authenticate() {
    return new Promise((resolve, reject) => {
      const authTimeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, config.HANDSHAKE_TIMEOUT);

      this.ws.once('message', async (data) => {
        clearTimeout(authTimeout);
        try {
          const response = JSON.parse(data.toString());
          const authId = response.id;

          if (!authId) {
            logger.error('Authentication ID not received');
            return resolve(false);
          }

          const authPayload = {
            id: authId,
            origin_action: 'AUTH',
            result: {
              browser_id: this.browserId,
              user_id: this.userId,
              user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
              timestamp: Math.floor(Date.now() / 1000),
              device_type: 'desktop',
              version: config.VERSION
            }
          };

          await this.sendMessage(authPayload);
          this.isAuthenticated = true;
          logger.info(chalk.green('Authentication successful'));
          resolve(true);
        } catch (error) {
          logger.error(`Authentication failed: ${error.message}`);
          resolve(false);
        }
      });
    });
  }

  async handleHeartbeat() {
    while (this.ws?.readyState === WebSocket.OPEN) {
      try {
        const pingPayload = {
          id: uuidv4(),
          action: 'PING',
          data: {}
        };
        await this.sendMessage(pingPayload);
        logger.info(`Sent ${chalk.green('ping')} to server`);

        const pongPayload = {
          id: 'F3X',
          origin_action: 'PONG'
        };
        await this.sendMessage(pongPayload);
        logger.info(`Sent ${chalk.magenta('pong')} to server`);

        await new Promise(resolve => setTimeout(resolve, config.PING_INTERVAL));
      } catch (error) {
        logger.error(`Heartbeat error: ${error.message}`);
        break;
      }
    }
  }

  async sendMessage(payload) {
    if (!this.isAuthenticated && payload.origin_action !== 'AUTH') {
      throw new Error('Cannot send message before authentication');
    }
    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify(payload), (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

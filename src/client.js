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
    this.pointsMultiplier = 1.0;
    this.heartbeatInterval = null;
  }

  async start() {
    while (this.retryCount < config.MAX_RETRIES) {
      try {
        await this.connect();
        await this.startSession();
      } catch (error) {
        this.retryCount++;
        logger.error(
          `Connection error (attempt ${this.retryCount}/${config.MAX_RETRIES}): ${error.message}`
        );
        await this.handleReconnect();
      }
    }
  }

  async connect() {
    this.ws = new WebSocket(config.WEBSOCKET_URL, {
      headers: this.getHeaders(),
      proxy: this.proxy,
      handshakeTimeout: config.HANDSHAKE_TIMEOUT,
      perMessageDeflate: true
    });

    this.setupEventListeners();

    return new Promise((resolve, reject) => {
      this.ws.once('open', () => {
        logger.info(chalk.green('WebSocket connection established'));
        resolve();
      });
      this.ws.once('error', reject);
    });
  }

  setupEventListeners() {
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('close', () => {
      logger.warn('Connection closed');
      this.cleanup();
    });
    this.ws.on('error', (error) => {
      logger.error(`WebSocket error: ${error.message}`);
      this.proxyManager.trackProxyStatus(this.proxy, false);
    });
  }

  getHeaders() {
    return {
      'Host': 'proxy2.wynd.network:4650',
      'Connection': 'Upgrade',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Grass/1.0.0 Chrome/114.0.5735.289 Electron/25.8.1 Safari/537.36',
      'Upgrade': 'websocket',
      'Origin': 'https://app.getgrass.io',
      'Sec-WebSocket-Version': '13',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits'
    };
  }

  async startSession() {
    if (await this.authenticate()) {
      this.retryCount = 0;
      await this.startHeartbeat();
      await new Promise((resolve) => this.ws.once('close', resolve));
    }
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
              user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Grass/1.0.0 Chrome/114.0.5735.289 Electron/25.8.1 Safari/537.36',
              timestamp: Math.floor(Date.now() / 1000),
              device_type: 'desktop',
              version: config.VERSION
            }
          };

          await this.sendMessage(authPayload);
          this.isAuthenticated = true;
          this.proxyManager.trackProxyStatus(this.proxy, true);
          logger.info(chalk.green('Authentication successful'));
          resolve(true);
        } catch (error) {
          logger.error(`Authentication failed: ${error.message}`);
          resolve(false);
        }
      });
    });
  }

  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.action === 'UPDATE_MULTIPLIER') {
        this.pointsMultiplier = message.data.multiplier;
        logger.info(chalk.yellow(`Points Multiplier Updated: ${this.pointsMultiplier}x`));
      }
      
      if (message.action === 'PING') {
        this.handlePing(message.id);
      }
    } catch (error) {
      logger.error(`Failed to handle message: ${error.message}`);
    }
  }

  async handlePing(id) {
    try {
      await this.sendMessage({
        id: id,
        origin_action: 'PONG'
      });
      logger.info(chalk.blue('Responded to ping'));
    } catch (error) {
      logger.error(`Failed to respond to ping: ${error.message}`);
    }
  }

  async startHeartbeat() {
    this.heartbeatInterval = setInterval(async () => {
      try {
        const pingPayload = {
          id: uuidv4(),
          action: 'PING',
          data: {}
        };
        await this.sendMessage(pingPayload);
        logger.info(chalk.green('Heartbeat sent'));

        const pongPayload = {
          id: 'F3X',
          origin_action: 'PONG'
        };
        await this.sendMessage(pongPayload);
      } catch (error) {
        logger.error(`Heartbeat error: ${error.message}`);
        this.cleanup();
      }
    }, config.PING_INTERVAL);
  }

  async handleReconnect() {
    const delay = config.RECONNECT_DELAYS[
      Math.min(this.retryCount - 1, config.RECONNECT_DELAYS.length - 1)
    ];
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async sendMessage(payload) {
    if (!this.isAuthenticated && payload.origin_action !== 'AUTH') {
      throw new Error('Cannot send message before authentication');
    }
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket not connected'));
      }
      this.ws.send(JSON.stringify(payload), (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  cleanup() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }
    this.isAuthenticated = false;
  }
}

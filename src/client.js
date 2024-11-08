import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import pkg from 'https-proxy-agent';
const { HttpsProxyAgent } = pkg;
import { logger } from './logger.js';
import { config } from './config.js';

export class GrassClient {
  constructor(userId, proxy = null) {
    this.userId = userId;
    this.proxy = proxy;
    this.ws = null;
    this.browserId = uuidv4();
    this.deviceId = `Desktop-${Math.random().toString(36).substr(2, 9)}`;
    this.heartbeatInterval = null;
    this.retryCount = 0;
    this.maxRetries = 5;
  }

  async start() {
    while (this.retryCount < this.maxRetries) {
      try {
        await this.connect();
        await this.authenticate();
        this.startHeartbeat();
        
        await new Promise((resolve) => {
          this.ws.once('close', () => {
            logger.warn(`Connection closed for device ${this.deviceId} (${this.proxy})`);
            resolve();
          });
        });
        
        this.cleanup();
        this.retryCount = 0;
        await new Promise(resolve => setTimeout(resolve, 5000));
      } catch (error) {
        this.retryCount++;
        logger.error(`Connection error for device ${this.deviceId} (attempt ${this.retryCount}/${this.maxRetries}): ${error.message}`);
        this.cleanup();
        const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async connect() {
    const options = {
      headers: {
        'Host': 'proxy2.wynd.network:4650',
        'Connection': 'Upgrade',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Grass/${config.VERSION} Chrome/114.0.5735.289 Electron/25.8.1 Safari/537.36`,
        'Upgrade': 'websocket',
        'Origin': 'https://app.getgrass.io',
        'Sec-WebSocket-Version': '13',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-WebSocket-Extensions': 'permessage-deflate'
      }
    };

    if (this.proxy) {
      options.agent = new HttpsProxyAgent(this.proxy);
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://proxy2.wynd.network:4650', options);

      const timeout = setTimeout(() => {
        if (this.ws) {
          this.ws.terminate();
        }
        reject(new Error('Connection timeout'));
      }, 15000);

      this.ws.once('open', () => {
        clearTimeout(timeout);
        logger.info(`Device ${this.deviceId} connected via proxy: ${this.proxy}`);
        resolve();
      });

      this.ws.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async authenticate() {
    return new Promise((resolve, reject) => {
      const authTimeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, 15000);

      this.ws.once('message', async (data) => {
        clearTimeout(authTimeout);
        try {
          const response = JSON.parse(data.toString());
          await this.sendAuthPayload(response.id);
          logger.info(`Device ${this.deviceId} authentication successful`);
          resolve();
        } catch (error) {
          reject(new Error(`Authentication failed: ${error.message}`));
        }
      });
    });
  }

  async sendAuthPayload(authId) {
    const payload = {
      id: authId,
      origin_action: 'AUTH',
      result: {
        browser_id: this.browserId,
        user_id: this.userId,
        user_agent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Grass/${config.VERSION} Chrome/114.0.5735.289 Electron/25.8.1 Safari/537.36`,
        timestamp: Math.floor(Date.now() / 1000),
        device_type: 'desktop',
        device_id: this.deviceId,
        version: config.VERSION
      }
    };
    await this.sendMessage(payload);
  }

  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(async () => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          await this.sendMessage({
            id: uuidv4(),
            action: 'PING',
            data: {
              device_id: this.deviceId
            }
          });

          await this.sendMessage({
            id: 'F3X',
            origin_action: 'PONG',
            device_id: this.deviceId
          });
        } catch (error) {
          logger.error(`Heartbeat failed for device ${this.deviceId}: ${error.message}`);
        }
      }
    }, 20000);
  }

  async sendMessage(payload) {
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
  }
}

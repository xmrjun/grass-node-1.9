import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import pkg from 'https-proxy-agent';
const { HttpsProxyAgent } = pkg;
import { logger } from './logger.js';

export class GrassClient {
  constructor(userId, proxy = null) {
    this.userId = userId;
    this.proxy = proxy;
    this.ws = null;
    this.retryCount = 0;
    this.maxRetries = 10;
    this.browserId = uuidv4();
    this.isConnected = false;
    this.heartbeatInterval = null;
  }

  async start() {
    while (this.retryCount < this.maxRetries) {
      try {
        await this.connect();
        await this.authenticate();
        this.startHeartbeat();
        this.retryCount = 0;
        this.isConnected = true;
        return true;
      } catch (error) {
        this.retryCount++;
        logger.error(`Connection error for proxy ${this.proxy}: ${error.message}`);
        
        if (this.ws) {
          this.ws.close();
          this.ws = null;
        }

        if (this.retryCount < this.maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    return false;
  }

  async connect() {
    const options = {
      headers: {
        'Host': 'proxy2.wynd.network:4650',
        'Connection': 'Upgrade',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        'Upgrade': 'websocket',
        'Origin': 'https://app.getgrass.io',
        'Sec-WebSocket-Version': '13',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      handshakeTimeout: 30000,
      followRedirects: true
    };

    if (this.proxy) {
      options.agent = new HttpsProxyAgent(this.proxy);
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://proxy2.wynd.network:4650', options);

      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, 30000);

      this.ws.once('open', () => {
        clearTimeout(timeout);
        logger.info(`Connected via proxy: ${this.proxy}`);
        resolve();
      });

      this.ws.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.ws.on('close', () => {
        if (this.isConnected) {
          logger.warn(`Connection closed for proxy: ${this.proxy}`);
          this.cleanup();
          this.reconnect();
        }
      });
    });
  }

  async authenticate() {
    return new Promise((resolve, reject) => {
      const authTimeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, 30000);

      this.ws.once('message', async (data) => {
        clearTimeout(authTimeout);
        try {
          const response = JSON.parse(data.toString());
          await this.sendMessage({
            id: response.id,
            origin_action: 'AUTH',
            result: {
              browser_id: this.browserId,
              user_id: this.userId,
              user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
              timestamp: Math.floor(Date.now() / 1000),
              device_type: 'desktop',
              version: '4.28.1'
            }
          });
          logger.info('Authentication successful');
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
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
            data: {}
          });

          await this.sendMessage({
            id: 'F3X',
            origin_action: 'PONG'
          });
        } catch (error) {
          logger.error(`Heartbeat error: ${error.message}`);
          this.cleanup();
          this.reconnect();
        }
      }
    }, 30000);
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
    this.isConnected = false;
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

  async reconnect() {
    if (this.retryCount < this.maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
      await new Promise(resolve => setTimeout(resolve, delay));
      this.start();
    }
  }
}
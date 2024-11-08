import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';
import { Agent } from 'https';

export class GrassClient {
  constructor(userId, proxy = null) {
    this.userId = userId;
    this.proxy = proxy;
    this.ws = null;
    this.browserId = uuidv4();
    this.heartbeatInterval = null;
    this.reconnectTimeout = null;
    this.isAuthenticated = false;
    this.connectionAttempts = 0;
    this.maxRetries = 10;
    this.backoffDelay = 1000;
    this.maxBackoffDelay = 30000;
    this.isShuttingDown = false;
  }

  async start() {
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
    
    while (!this.isShuttingDown) {
      try {
        if (this.connectionAttempts >= this.maxRetries) {
          logger.warn(`Maximum retry attempts (${this.maxRetries}) reached for proxy: ${this.proxy}`);
          this.connectionAttempts = 0;
          await new Promise(resolve => setTimeout(resolve, this.maxBackoffDelay));
          continue;
        }

        await this.connect();
        await this.authenticate();
        this.startHeartbeat();
        this.connectionAttempts = 0;

        await new Promise((resolve) => {
          this.ws.once('close', () => {
            logger.warn(`Connection closed for proxy: ${this.proxy}`);
            resolve();
          });
        });

      } catch (error) {
        this.connectionAttempts++;
        const delay = Math.min(this.backoffDelay * Math.pow(2, this.connectionAttempts - 1), this.maxBackoffDelay);
        
        if (error.message.includes('404')) {
          logger.error(`Server endpoint not found (404). Waiting longer before retry...`);
          await new Promise(resolve => setTimeout(resolve, this.maxBackoffDelay));
        } else {
          const errorMessage = this.getErrorMessage(error);
          logger.error(`Connection error (attempt ${this.connectionAttempts}): ${errorMessage}`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } finally {
        this.cleanup();
      }
    }
  }

  getErrorMessage(error) {
    if (error.code === 'ECONNRESET') {
      return 'Connection reset by peer';
    }
    if (error.code === 'ETIMEDOUT') {
      return 'Connection timed out';
    }
    return error.message;
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
      timeout: 30000,
      followRedirects: true,
      maxPayload: 1024 * 1024,
      rejectUnauthorized: false,
      agent: new Agent({
        rejectUnauthorized: false,
        keepAlive: true,
        timeout: 30000
      })
    };

    if (this.proxy) {
      options.proxy = this.proxy;
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket('wss://proxy2.wynd.network:4650', options);

        const connectionTimeout = setTimeout(() => {
          if (this.ws && this.ws.readyState !== WebSocket.OPEN) {
            this.ws.terminate();
            reject(new Error('Connection timeout'));
          }
        }, 30000);

        this.ws.once('open', () => {
          clearTimeout(connectionTimeout);
          logger.info(`Connected via proxy: ${this.proxy}`);
          resolve();
        });

        this.ws.once('error', (error) => {
          clearTimeout(connectionTimeout);
          reject(error);
        });

        this.ws.on('unexpected-response', (request, response) => {
          clearTimeout(connectionTimeout);
          reject(new Error(`Unexpected server response: ${response.statusCode}`));
        });

      } catch (error) {
        reject(error);
      }
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
          await this.sendAuthPayload(response.id);
          this.isAuthenticated = true;
          logger.info('Authentication successful');
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
        user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
        timestamp: Math.floor(Date.now() / 1000),
        device_type: 'desktop',
        version: '4.28.1'
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
            data: {}
          });

          await this.sendMessage({
            id: 'F3X',
            origin_action: 'PONG'
          });
        } catch (error) {
          logger.error(`Heartbeat failed: ${error.message}`);
          this.cleanup();
        }
      }
    }, 30000);
  }

  async sendMessage(payload) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error('WebSocket not connected'));
      }

      const timeout = setTimeout(() => {
        reject(new Error('Send message timeout'));
      }, 10000);

      this.ws.send(JSON.stringify(payload), (error) => {
        clearTimeout(timeout);
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

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
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

  shutdown() {
    this.isShuttingDown = true;
    this.cleanup();
  }
}

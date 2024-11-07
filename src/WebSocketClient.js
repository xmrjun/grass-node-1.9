import WebSocket from 'ws';
import { v4 as uuid } from 'uuid';
import { logger } from './logger.js';
import { ProxyManager } from './ProxyManager.js';

export class WebSocketClient {
  constructor(userId, proxy = null) {
    this.userId = userId;
    this.proxy = proxy;
    this.ws = null;
    this.retryCount = 0;
    this.maxRetries = 20; // 增加最大重试次数
    this.heartbeatInterval = null;
    this.reconnectTimeout = null;
    this.isAuthenticated = false;
    this.browserId = uuid();
    this.proxyManager = new ProxyManager();
    this.connectionAttempts = 0;
    this.lastConnectTime = 0;
  }

  async connect() {
    while (this.connectionAttempts < this.maxRetries) {
      try {
        // 检查上次连接时间,避免频繁重连
        const now = Date.now();
        const timeSinceLastConnect = now - this.lastConnectTime;
        if (timeSinceLastConnect < 5000) {
          await new Promise(resolve => setTimeout(resolve, 5000 - timeSinceLastConnect));
        }
        this.lastConnectTime = Date.now();

        if (!this.proxyManager.isViable(this.proxy)) {
          throw new Error('Proxy is currently blocked');
        }

        const agent = this.proxyManager.createAgent(this.proxy);
        
        this.ws = new WebSocket('wss://proxy2.wynd.network:4650', {
          headers: this.getHeaders(),
          agent,
          handshakeTimeout: 30000, // 增加超时时间
          followRedirects: true,
          maxPayload: 1024 * 1024 // 1MB
        });

        await this.setupWebSocket();
        await this.authenticate();
        this.startHeartbeat();
        
        // 重置重试计数
        this.connectionAttempts = 0;
        this.proxyManager.trackStatus(this.proxy, true);
        return true;
      } catch (error) {
        this.connectionAttempts++;
        this.proxyManager.trackStatus(this.proxy, false);
        this.cleanup();
        
        // 计算递增的重试延迟
        const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30000);
        logger.error(`Connection attempt ${this.connectionAttempts}/${this.maxRetries} failed: ${error.message}`);
        logger.info(`Retrying in ${delay/1000} seconds...`);
        
        if (this.connectionAttempts === this.maxRetries) {
          logger.error('Max retries reached, stopping connection attempts');
          return false;
        }
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    return false;
  }

  getHeaders() {
    return {
      'Host': 'proxy2.wynd.network:4650',
      'Upgrade': 'websocket',
      'Connection': 'Upgrade',
      'Sec-WebSocket-Version': '13',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
      'Origin': 'https://app.getgrass.io',
      'Accept-Language': 'en-US,en;q=0.9',
      'Pragma': 'no-cache',
      'Cache-Control': 'no-cache'
    };
  }

  async setupWebSocket() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.cleanup();
      }, 30000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        logger.info(`Connected ${this.proxy ? `via proxy: ${this.proxy}` : 'directly'}`);
        resolve();
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.ws.on('close', () => {
        this.handleDisconnect();
      });

      this.ws.on('message', (data) => this.handleMessage(data));

      // 添加ping/pong处理
      this.ws.on('ping', () => {
        try {
          this.ws.pong();
        } catch (error) {
          logger.error(`Failed to send pong: ${error.message}`);
        }
      });
    });
  }

  async authenticate() {
    return new Promise((resolve, reject) => {
      const authTimeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
        this.cleanup();
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
            id: uuid(),
            action: 'PING',
            data: {}
          });

          await this.sendMessage({
            id: 'F3X',
            origin_action: 'PONG'
          });
        } catch (error) {
          logger.error(`Heartbeat failed: ${error.message}`);
          this.handleDisconnect();
        }
      }
    }, 30000);
  }

  handleDisconnect() {
    logger.warn(`WebSocket closed (${this.proxy || 'direct connection'})`);
    this.cleanup();
    
    // 使用递增的重连延迟
    const delay = Math.min(1000 * Math.pow(2, this.connectionAttempts), 30000);
    
    if (this.connectionAttempts < this.maxRetries) {
      this.reconnectTimeout = setTimeout(() => {
        this.connect().catch(() => {});
      }, delay);
    }
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

  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      if (message.action === 'PING') {
        this.sendMessage({
          id: message.id,
          origin_action: 'PONG'
        }).catch(error => {
          logger.error(`Failed to send PONG: ${error.message}`);
        });
      }
    } catch (error) {
      logger.error(`Failed to handle message: ${error.message}`);
    }
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
}
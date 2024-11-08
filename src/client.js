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
    this.browserId = uuidv4();
    this.isConnected = false;
    this.heartbeatInterval = null;
    this.healthCheckInterval = null;
    this.lastHeartbeat = Date.now();
    this.lastPongTime = Date.now();
    this.missedHeartbeats = 0;
    this.connectionStartTime = 0;
    this.consecutiveFailures = 0;
    
    // Constants
    this.MAX_MISSED_HEARTBEATS = 2;
    this.HEARTBEAT_INTERVAL = 25000; // 25秒
    this.HEALTH_CHECK_INTERVAL = 15000; // 15秒
    this.MIN_RECONNECT_DELAY = 15000; // 15秒
    this.MAX_RECONNECT_DELAY = 120000; // 2分钟
    this.CONNECTION_TIMEOUT = 30000; // 30秒
    this.MIN_CONNECTION_TIME = 30000; // 连接至少保持30秒才重置失败计数
  }

  async start() {
    while (true) {
      try {
        await this.connect();
        await this.authenticate();
        this.startHeartbeat();
        this.startHealthCheck();
        this.isConnected = true;
        this.connectionStartTime = Date.now();
        
        // 等待连接关闭
        await new Promise((resolve) => {
          this.ws.once('close', () => {
            const connectionDuration = Date.now() - this.connectionStartTime;
            if (connectionDuration > this.MIN_CONNECTION_TIME) {
              this.consecutiveFailures = 0; // 重置失败计数
              this.retryCount = 0;
            } else {
              this.consecutiveFailures++;
            }
            resolve();
          });
        });
        
        logger.warn(`Connection closed for proxy: ${this.proxy}`);
        this.cleanup();
        
        // 计算重连延迟
        const delay = this.calculateReconnectDelay();
        logger.info(`Reconnecting in ${Math.floor(delay/1000)} seconds...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
      } catch (error) {
        logger.error(`Connection error: ${error.message}`);
        this.cleanup();
        this.consecutiveFailures++;
        
        const delay = this.calculateReconnectDelay();
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  calculateReconnectDelay() {
    // 基于连续失败次数计算延迟
    const baseDelay = Math.min(
      this.MIN_RECONNECT_DELAY * Math.pow(1.5, this.consecutiveFailures),
      this.MAX_RECONNECT_DELAY
    );
    
    // 添加随机抖动，避免多个客户端同时重连
    const jitter = Math.random() * 5000;
    return baseDelay + jitter;
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
      handshakeTimeout: this.CONNECTION_TIMEOUT,
      followRedirects: true,
      maxPayload: 1024 * 1024,
      perMessageDeflate: false
    };

    if (this.proxy) {
      try {
        const proxyUrl = new URL(this.proxy);
        options.agent = new HttpsProxyAgent({
          protocol: proxyUrl.protocol,
          host: proxyUrl.hostname,
          port: proxyUrl.port,
          auth: proxyUrl.username && proxyUrl.password ? 
            `${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}` : 
            undefined,
          rejectUnauthorized: false,
          timeout: this.CONNECTION_TIMEOUT,
          keepAlive: true,
          keepAliveMsecs: 15000,
          maxSockets: 1,
          scheduling: 'lifo'
        });
      } catch (error) {
        throw new Error(`Invalid proxy URL: ${error.message}`);
      }
    }

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket('wss://proxy2.wynd.network:4650', options);
        
        const connectTimeout = setTimeout(() => {
          if (this.ws) {
            this.ws.terminate();
          }
          reject(new Error('Connection timeout'));
        }, this.CONNECTION_TIMEOUT);

        this.ws.once('open', () => {
          clearTimeout(connectTimeout);
          logger.info(`Connected via proxy: ${this.proxy}`);
          resolve();
        });

        this.ws.once('error', (error) => {
          clearTimeout(connectTimeout);
          reject(error);
        });

        this.setupWebSocketHandlers();
      } catch (error) {
        reject(error);
      }
    });
  }

  setupWebSocketHandlers() {
    this.ws.on('ping', () => {
      try {
        this.ws.pong();
        this.lastPongTime = Date.now();
        this.missedHeartbeats = 0;
      } catch (error) {
        logger.error(`Failed to send pong: ${error.message}`);
      }
    });

    this.ws.on('pong', () => {
      this.lastPongTime = Date.now();
      this.missedHeartbeats = 0;
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.action === 'PING') {
          this.sendMessage({
            id: message.id,
            origin_action: 'PONG'
          }).catch(() => {});
        }
        this.lastHeartbeat = Date.now();
        this.missedHeartbeats = 0;
      } catch (error) {}
    });
  }

  async authenticate() {
    return new Promise((resolve, reject) => {
      const authTimeout = setTimeout(() => {
        reject(new Error('Authentication timeout'));
      }, this.CONNECTION_TIMEOUT);

      this.ws.once('message', async (data) => {
        clearTimeout(authTimeout);
        try {
          const response = JSON.parse(data.toString());
          await this.sendAuthPayload(response.id);
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
          
          this.missedHeartbeats++;
          if (this.missedHeartbeats >= this.MAX_MISSED_HEARTBEATS) {
            logger.warn('Too many missed heartbeats, reconnecting...');
            this.ws?.terminate();
            return;
          }
        } catch (error) {
          logger.error(`Heartbeat failed: ${error.message}`);
          this.ws?.terminate();
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  startHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      const now = Date.now();
      const heartbeatAge = now - this.lastHeartbeat;
      const pongAge = now - this.lastPongTime;
      
      if (heartbeatAge > 45000 || pongAge > 45000) {
        logger.warn('Connection seems dead, forcing reconnect...');
        this.ws?.terminate();
      }
    }, this.HEALTH_CHECK_INTERVAL);
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
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close();
      }
      this.ws = null;
    }
    
    this.isConnected = false;
  }
}

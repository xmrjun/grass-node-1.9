import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

export class GrassClient {
  constructor(userId) {
    this.userId = userId;
    this.ws = null;
    this.browserId = uuidv4();
    this.deviceName = `Grass-Node-${Math.random().toString(36).substr(2, 9)}`;
    this.heartbeatInterval = null;
    this.multiplier = 1.0;
  }

  async start() {
    try {
      await this.connect();
      await this.authenticate();
      this.startHeartbeat();
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          // 处理连接成功消息
          if (message.action === 'CONNECTION_SUCCESS') {
            logger.info('设备成功连接!');
            logger.info(`当前积分倍数: ${this.multiplier}x`);
          }
          
          // 处理积分倍数更新
          if (message.action === 'UPDATE_MULTIPLIER' && message.data?.multiplier) {
            this.multiplier = message.data.multiplier;
            logger.info(`积分倍数更新: ${this.multiplier}x`);
          }
        } catch (error) {
          logger.error(`消息处理错误: ${error.message}`);
        }
      });
      
    } catch (error) {
      logger.error(`连接错误: ${error.message}`);
      setTimeout(() => this.start(), 5000);
    }
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://proxy2.wynd.network:4650', {
        headers: {
          'Host': 'proxy2.wynd.network:4650',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
          'Origin': 'https://app.getgrass.io'
        }
      });

      this.ws.once('open', () => {
        logger.info('WebSocket连接已建立');
        resolve();
      });

      this.ws.once('error', (error) => {
        reject(error);
      });
    });
  }

  async authenticate() {
    return new Promise((resolve, reject) => {
      const authTimeout = setTimeout(() => {
        reject(new Error('认证超时'));
      }, 30000);

      this.ws.once('message', async (data) => {
        clearTimeout(authTimeout);
        try {
          const response = JSON.parse(data.toString());
          await this.sendAuthPayload(response.id);
          logger.info('认证成功');
          resolve();
        } catch (error) {
          reject(new Error(`认证失败: ${error.message}`));
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
        device_name: this.deviceName,
        version: '4.28.1'
      }
    };
    await this.sendMessage(payload);
  }

  startHeartbeat() {

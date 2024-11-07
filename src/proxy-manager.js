import pkg from 'https-proxy-agent';
const { HttpsProxyAgent } = pkg;
import { logger } from './logger.js';

export class ProxyManager {
  constructor() {
    this.proxyStatus = new Map();
    this.failureThreshold = 5; // 增加失败阈值
    this.successThreshold = 3;
    this.retryTimeout = 120000; // 增加重试超时
  }

  createAgent(proxyUrl) {
    if (!proxyUrl) return null;
    
    try {
      const url = new URL(proxyUrl);
      return new HttpsProxyAgent({
        protocol: url.protocol,
        host: url.hostname,
        port: url.port,
        auth: url.username && url.password ? 
          `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}` : 
          undefined,
        rejectUnauthorized: false,
        timeout: 30000,
        keepAlive: true,
        keepAliveMsecs: 30000,
        maxSockets: 1
      });
    } catch (error) {
      logger.error(`Invalid proxy URL: ${proxyUrl}`);
      return null;
    }
  }

  trackStatus(proxy, success) {
    if (!proxy) return;
    
    if (!this.proxyStatus.has(proxy)) {
      this.proxyStatus.set(proxy, { 
        failures: 0, 
        successes: 0, 
        lastFailure: 0,
        lastSuccess: 0
      });
    }

    const status = this.proxyStatus.get(proxy);
    const now = Date.now();
    
    if (success) {
      status.successes++;
      status.failures = 0;
      status.lastSuccess = now;
    } else {
      status.failures++;
      status.successes = 0;
      status.lastFailure = now;
    }
  }

  isViable(proxy) {
    if (!proxy) return true;
    
    const status = this.proxyStatus.get(proxy);
    if (!status) return true;

    if (status.failures >= this.failureThreshold) {
      const timeSinceLastFailure = Date.now() - status.lastFailure;
      if (timeSinceLastFailure < this.retryTimeout) {
        return false;
      }
      // 重置状态
      this.proxyStatus.set(proxy, { 
        failures: 0, 
        successes: 0, 
        lastFailure: 0,
        lastSuccess: 0
      });
    }
    
    return true;
  }
}
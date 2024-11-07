import pkg from 'https-proxy-agent';
const { HttpsProxyAgent } = pkg;

export class ProxyManager {
  constructor() {
    this.proxyStatus = new Map();
    this.failureThreshold = 3;
    this.successThreshold = 5;
    this.retryTimeout = 300000; // 5 minutes
  }

  validateProxy(proxy) {
    if (!proxy) return true;
    
    const proxyRegex = /^(http|https|socks[45]):\/\/([^:]+:[^@]+@)?([a-zA-Z0-9.-]+):\d{1,5}$/;
    return proxyRegex.test(proxy);
  }

  createAgent(proxy) {
    if (!proxy) return null;
    
    try {
      return new HttpsProxyAgent(proxy);
    } catch (error) {
      console.error(`Failed to create proxy agent: ${error.message}`);
      return null;
    }
  }

  trackProxyStatus(proxy, success) {
    if (!proxy) return;
    
    if (!this.proxyStatus.has(proxy)) {
      this.proxyStatus.set(proxy, { failures: 0, successes: 0, lastFailure: 0 });
    }

    const status = this.proxyStatus.get(proxy);
    
    if (success) {
      status.successes++;
      status.failures = 0;
    } else {
      status.failures++;
      status.successes = 0;
      status.lastFailure = Date.now();
    }
  }

  isProxyViable(proxy) {
    if (!proxy) return true;
    
    const status = this.proxyStatus.get(proxy);
    if (!status) return true;

    if (status.failures >= this.failureThreshold) {
      const timeSinceLastFailure = Date.now() - status.lastFailure;
      if (timeSinceLastFailure < this.retryTimeout) {
        return false;
      }
      // Reset proxy status after timeout
      this.proxyStatus.set(proxy, { failures: 0, successes: 0, lastFailure: 0 });
    }
    
    return true;
  }

  getProxyHealth(proxy) {
    if (!proxy) return 'direct';
    
    const status = this.proxyStatus.get(proxy);
    if (!status) return 'unknown';
    
    if (status.failures >= this.failureThreshold) return 'failed';
    if (status.successes >= this.successThreshold) return 'healthy';
    return 'testing';
  }

  resetProxy(proxy) {
    this.proxyStatus.delete(proxy);
  }
}
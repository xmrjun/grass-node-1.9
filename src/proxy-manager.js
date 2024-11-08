export class ProxyManager {
  constructor() {
    this.proxyStatus = new Map();
    this.failureThreshold = 3;
    this.successThreshold = 2;
    this.retryTimeout = 60000; // 1 minute cooldown
    this.maxFailures = 5;
  }

  trackProxyStatus(proxy, success) {
    if (!proxy) return;
    
    if (!this.proxyStatus.has(proxy)) {
      this.proxyStatus.set(proxy, {
        failures: 0,
        successes: 0,
        lastFailure: 0,
        lastSuccess: 0,
        totalFailures: 0
      });
    }

    const status = this.proxyStatus.get(proxy);
    const now = Date.now();
    
    if (success) {
      status.successes++;
      status.failures = Math.max(0, status.failures - 1);
      status.lastSuccess = now;
      if (status.successes >= this.successThreshold) {
        status.totalFailures = Math.max(0, status.totalFailures - 1);
      }
    } else {
      status.failures++;
      status.successes = 0;
      status.lastFailure = now;
      status.totalFailures++;
    }
  }

  isProxyViable(proxy) {
    if (!proxy) return true;
    
    const status = this.proxyStatus.get(proxy);
    if (!status) return true;

    // 检查短期失败
    if (status.failures >= this.failureThreshold) {
      const timeSinceLastFailure = Date.now() - status.lastFailure;
      if (timeSinceLastFailure < this.retryTimeout) {
        return false;
      }
      // 重置失败计数
      status.failures = Math.max(0, status.failures - 1);
    }

    // 检查总失败次数
    if (status.totalFailures >= this.maxFailures) {
      const timeSinceLastFailure = Date.now() - status.lastFailure;
      if (timeSinceLastFailure < this.retryTimeout * 2) {
        return false;
      }
      // 逐步减少总失败计数
      status.totalFailures = Math.max(0, status.totalFailures - 1);
    }

    return true;
  }

  resetProxy(proxy) {
    this.proxyStatus.delete(proxy);
  }
}

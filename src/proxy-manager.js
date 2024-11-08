export class ProxyManager {
  constructor() {
    this.proxyStatus = new Map();
    this.failureThreshold = 5;
    this.successThreshold = 3;
    this.retryTimeout = 300000; // 5 minutes cooldown
    this.maxFailures = 10;
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
      status.failures = 0;
      status.lastSuccess = now;
      // 成功后重置总失败次数
      if (status.successes >= this.successThreshold) {
        status.totalFailures = 0;
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
    }

    // 检查长期失败
    if (status.totalFailures >= this.maxFailures) {
      const timeSinceLastFailure = Date.now() - status.lastFailure;
      if (timeSinceLastFailure < this.retryTimeout * 2) {
        return false;
      }
      // 重置长期失败计数
      status.totalFailures = 0;
    }

    return true;
  }

  resetProxy(proxy) {
    this.proxyStatus.delete(proxy);
  }
}

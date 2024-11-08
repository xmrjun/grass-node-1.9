export class ProxyManager {
  constructor() {
    this.proxyStatus = new Map();
    this.failureThreshold = 3;
    this.successThreshold = 2;
    this.retryTimeout = 30000;
  }

  trackProxyStatus(proxy, success) {
    if (!proxy) return;
    
    if (!this.proxyStatus.has(proxy)) {
      this.proxyStatus.set(proxy, {
        failures: 0,
        successes: 0,
        lastFailure: 0
      });
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
      this.proxyStatus.set(proxy, {
        failures: 0,
        successes: 0,
        lastFailure: 0
      });
    }
    
    return true;
  }
}
#1

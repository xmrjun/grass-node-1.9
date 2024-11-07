export class SecurityManager {
  constructor() {
    this.rateLimits = new Map();
    this.MAX_REQUESTS = 60;
    this.TIME_WINDOW = 60000;
  }

  validateProxy(proxy) {
    if (!proxy) return true;
    
    const proxyRegex = /^(http|https|socks[45]):\/\/([^:]+:[^@]+@)?([a-zA-Z0-9.-]+):\d{1,5}$/;
    if (!proxyRegex.test(proxy)) {
      throw new Error('Invalid proxy format');
    }
    return true;
  }

  validateUserId(userId) {
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid user ID format');
    }
    
    if (userId.length < 5 || userId.length > 100) {
      throw new Error('User ID length must be between 5 and 100 characters');
    }
    
    const validUserIdRegex = /^[a-zA-Z0-9_-]+$/;
    if (!validUserIdRegex.test(userId)) {
      throw new Error('User ID contains invalid characters');
    }
    
    return true;
  }

  checkRateLimit(clientId) {
    const now = Date.now();
    const clientRequests = this.rateLimits.get(clientId) || [];
    
    const validRequests = clientRequests.filter(time => now - time < this.TIME_WINDOW);
    
    if (validRequests.length >= this.MAX_REQUESTS) {
      throw new Error('Rate limit exceeded');
    }
    
    validRequests.push(now);
    this.rateLimits.set(clientId, validRequests);
    return true;
  }
}
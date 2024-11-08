export const config = {
  WEBSOCKET_URL: 'wss://proxy2.wynd.network:4650/',
  VERSION: '2.0.0',
  PING_INTERVAL: 20000,
  MAX_RETRIES: 0,
  HANDSHAKE_TIMEOUT: 30000,
  RECONNECT_DELAY: 5000,
  SECURITY: {
    VALID_PROXY_REGEX: /^(http|https|socks[45]):\/\/([^:]+:[^@]+@)?([a-zA-Z0-9.-]+):\d{1,5}$/
  }
};

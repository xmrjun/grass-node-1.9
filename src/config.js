export const config = {
  WEBSOCKET_URL: 'wss://proxy2.wynd.network:4650/',
  VERSION: '4.28.1',
  PING_INTERVAL: 30000,
  MAX_RETRIES: 5,
  HANDSHAKE_TIMEOUT: 10000,
  RECONNECT_DELAYS: [1000, 2000, 5000, 10000],
  SECURITY: {
    VALID_PROXY_REGEX: /^(http|https|socks[45]):\/\/([^:]+:[^@]+@)?([a-zA-Z0-9.-]+):\d{1,5}$/
  }
};

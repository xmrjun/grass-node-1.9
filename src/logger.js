import chalk from 'chalk';

const getTime = () => new Date().toLocaleTimeString('en-US', { 
  hour12: false,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

export const logger = {
  info: msg => console.log(`[${getTime()}] ${chalk.blue('ℹ️')} ${msg}`),
  error: msg => console.error(`[${getTime()}] ${chalk.red('❌')} ${msg}`),
  warn: msg => console.warn(`[${getTime()}] ${chalk.yellow('⚠️')} ${msg}`)
};

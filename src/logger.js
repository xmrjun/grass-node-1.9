import chalk from 'chalk';

function getTimestamp() {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

export const logger = {
  info: (message) => console.log(`${chalk.gray(getTimestamp())} - ${message}`),
  success: (message) => console.log(`${chalk.gray(getTimestamp())} - ${chalk.green(message)}`),
  error: (message) => console.error(`${chalk.gray(getTimestamp())} - ${chalk.red(message)}`),
  warn: (message) => console.warn(`${chalk.gray(getTimestamp())} - ${chalk.yellow(message)}`)
};

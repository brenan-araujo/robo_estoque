const winston = require('winston');

const inMemoryLogs = [];
const MAX_IN_MEMORY_LOGS = 10;

const memoryFormat = winston.format((info) => {
    const timestamp = info.timestamp || new Date().toLocaleString('pt-BR');
    const line = `[${timestamp}] ${info.level.toUpperCase()}: ${info.message}`;
    inMemoryLogs.push(line);
    if (inMemoryLogs.length > MAX_IN_MEMORY_LOGS) {
        inMemoryLogs.shift();
    }
    return info;
});

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'DD/MM/YYYY HH:mm:ss' }),
        memoryFormat(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.Console()
    ]
});

// Test logging
logger.info('Test log 1');
logger.warn('Test log 2');
logger.error('Test log 3');

console.log('\n--- InMemory Logs ---');
console.log(inMemoryLogs);

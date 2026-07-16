const winston = require('winston');
const path = require('path');
const fs = require('fs');

const logDir = path.join(__dirname, '..', '..', 'logs');

// Buffer de logs em memória para evitar leituras de disco no endpoint HTTP
const inMemoryLogs = [];
const MAX_IN_MEMORY_LOGS = 100;

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
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'DD/MM/YYYY HH:mm:ss' }),
        memoryFormat(), // Salva no buffer em memória
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        // Console com cores
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `[${timestamp}] ${level}: ${message}`;
                })
            )
        }),
        // Arquivo de log
        new winston.transports.File({
            filename: path.join(logDir, 'app.log'),
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 3,
        }),
        // Arquivo de erros
        new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
            maxsize: 5 * 1024 * 1024,
            maxFiles: 3,
        }),
    ],
});

// Carrega os últimos logs do arquivo app.log na inicialização para popular o buffer
try {
    const logFile = path.join(logDir, 'app.log');
    if (fs.existsSync(logFile)) {
        const data = fs.readFileSync(logFile, 'utf8');
        const lines = data.split('\n').filter(line => line.trim() !== '');
        inMemoryLogs.push(...lines.slice(-MAX_IN_MEMORY_LOGS));
    }
} catch (err) {
    console.error('Falha ao carregar logs iniciais do arquivo:', err.message);
}

logger.getMemoryLogs = () => [...inMemoryLogs];

module.exports = logger;

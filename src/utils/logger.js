const winston = require('winston');
const path = require('path');

const logDir = path.join(__dirname, '..', '..', 'logs');

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'DD/MM/YYYY HH:mm:ss' }),
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

module.exports = logger;

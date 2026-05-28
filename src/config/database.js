const oracledb = require('oracledb');
const logger = require('../utils/logger');

// Inicializa o Oracle Client em modo Thick (necessário para autenticação 10G)
oracledb.initOracleClient({ libDir: process.env.ORACLE_CLIENT_DIR });

let pool = null;

/**
 * Cria o pool de conexões Oracle
 */
async function initialize() {
    try {
        pool = await oracledb.createPool({
            user: process.env.ORACLE_USER,
            password: process.env.ORACLE_PASS,
            connectString: process.env.ORACLE_CONNECTION_STRING,
            poolMin: 1,
            poolMax: 3,
            poolIncrement: 1,
            poolTimeout: 60,
        });
        logger.info('✅ Pool de conexão Oracle criado com sucesso');
    } catch (err) {
        logger.error(`❌ Erro ao criar pool Oracle: ${err.message}`);
        throw err;
    }
}

/**
 * Obtém uma conexão do pool
 */
async function getConnection() {
    if (!pool) {
        throw new Error('Pool Oracle não inicializado. Chame initialize() primeiro.');
    }
    return await pool.getConnection();
}

/**
 * Fecha o pool de conexões
 */
async function close() {
    if (pool) {
        try {
            await pool.close(2);
            logger.info('Pool Oracle fechado');
        } catch (err) {
            logger.error(`Erro ao fechar pool: ${err.message}`);
        }
    }
}

module.exports = { initialize, getConnection, close, oracledb };

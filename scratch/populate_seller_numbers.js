require('dotenv').config();
const db = require('../src/config/database');
const oracledb = require('oracledb');
const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = path.join(__dirname, '..', 'data', 'settings.json');

function formatNumber(num) {
    if (!num) return null;
    const cleaned = String(num).replace(/\D/g, '');
    if (cleaned.length === 10 || cleaned.length === 11) {
        return `55${cleaned}`;
    }
    if ((cleaned.length === 12 || cleaned.length === 13) && cleaned.startsWith('55')) {
        return cleaned;
    }
    // Caso o número tenha pelo menos 8 dígitos, tenta acrescentar 55 + DDD padrão se for muito curto, 
    // mas o melhor é retornar apenas se for um número celular BR válido com DDD (10/11) ou completo (12/13).
    if (cleaned.length >= 8 && cleaned.length < 10) {
        // Se for de Brasília (filiais da região costumam ter DDD 61)
        return `5561${cleaned}`;
    }
    return null;
}

async function populateSellers() {
    try {
        await db.initialize();
        const connection = await db.getConnection();

        // 1. Buscar todos os vendedores ativos (com meta no mês e sem marcações administrativas)
        const query = `
            SELECT DISTINCT
                U.CODUSUR,
                U.CODFILIAL,
                U.TELEFONE1,
                U.TELEFONE2,
                U.PSA_TELWHATS
            FROM PCUSUARI U
            JOIN PCMETA M ON M.CODUSUR = U.CODUSUR
            WHERE U.BLOQUEIO = 'N'
            AND U.CODFILIAL IS NOT NULL
            AND U.NOME NOT LIKE '%PROSPECT%'
            AND U.NOME NOT LIKE '%**%'
            AND M.DATA >= TRUNC(SYSDATE, 'MM')
            AND M.DATA < ADD_MONTHS(TRUNC(SYSDATE, 'MM'), 1)
        `;

        const result = await connection.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        
        // 2. Agrupar números por filial
        const numbersByFilial = {};
        
        result.rows.forEach(r => {
            const codFilial = String(r.CODFILIAL).trim();
            if (!numbersByFilial[codFilial]) {
                numbersByFilial[codFilial] = new Set();
            }

            const numsToTry = [r.PSA_TELWHATS, r.TELEFONE1, r.TELEFONE2];
            numsToTry.forEach(num => {
                if (num) {
                    const formatted = formatNumber(num);
                    if (formatted) {
                        numbersByFilial[codFilial].add(formatted);
                    }
                }
            });
        });

        // 3. Ler o settings.json atual
        let settings = { filialNumbers: {} };
        if (fs.existsSync(SETTINGS_FILE)) {
            settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }

        if (!settings.filialNumbers) {
            settings.filialNumbers = {};
        }

        // 4. Preencher e mesclar as informações no settings.json
        console.log('=== Atualizações por Filial ===');
        Object.entries(numbersByFilial).forEach(([filial, setOfNumbers]) => {
            // Mesclar com números existentes na filial para não perder nenhum configurado manualmente
            const currentList = settings.filialNumbers[filial]
                ? settings.filialNumbers[filial].split(/[\n,]+/).map(n => n.trim().replace(/\D/g, '')).filter(Boolean)
                : [];
            
            const mergedSet = new Set([...currentList, ...setOfNumbers]);
            const mergedArray = Array.from(mergedSet).filter(num => num.length >= 10); // Garante números válidos
            
            settings.filialNumbers[filial] = mergedArray.join(', ');
            console.log(`Filial ${filial}: ${mergedArray.length} números configurados.`);
        });

        // Salvar as alterações
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
        console.log(`\n✅ Arquivo settings.json atualizado com sucesso em: ${SETTINGS_FILE}`);

        await connection.close();
    } catch (err) {
        console.error('Erro ao atualizar configurações:', err);
    } finally {
        await db.close();
        process.exit(0);
    }
}

populateSellers();

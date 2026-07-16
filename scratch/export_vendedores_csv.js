require('dotenv').config();
const db = require('../src/config/database');
const oracledb = require('oracledb');
const fs = require('fs');
const path = require('path');

// Função de formatação de filiais idêntica à do relatório
function formatFilialName(codFilial, defaultName) {
    const cod = String(codFilial).trim();
    if (cod === '20') return '20 - Brago Brasília';
    if (cod === '21') return '21 - Brago Goiânia';
    if (defaultName) {
        if (defaultName.startsWith(cod)) {
            return defaultName;
        }
        return `${cod} - ${defaultName}`;
    }
    return `${cod} - Filial ${cod}`;
}

async function exportToCsv() {
    try {
        await db.initialize();
        const connection = await db.getConnection();

        // Query strict que busca apenas vendedores ativos (com meta no mês atual e sem marcações administrativas)
        const query = `
            SELECT DISTINCT
                U.CODUSUR,
                U.NOME AS NOME_VENDEDOR,
                U.CODFILIAL,
                F.RAZAOSOCIAL AS NOME_FILIAL,
                U.TELEFONE1,
                U.TELEFONE2,
                U.PSA_TELWHATS
            FROM PCUSUARI U
            LEFT JOIN PCFILIAL F ON F.CODIGO = U.CODFILIAL
            JOIN PCMETA M ON M.CODUSUR = U.CODUSUR
            WHERE U.BLOQUEIO = 'N'
            AND U.CODFILIAL IS NOT NULL
            AND U.NOME NOT LIKE '%PROSPECT%'
            AND U.NOME NOT LIKE '%**%'
            AND M.DATA >= TRUNC(SYSDATE, 'MM')
            AND M.DATA < ADD_MONTHS(TRUNC(SYSDATE, 'MM'), 1)
            ORDER BY U.CODFILIAL, U.CODUSUR
        `;

        const result = await connection.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        
        // Cabeçalho do CSV
        let csvContent = 'Código RCA;Nome Vendedor;Código Filial;Filial Formatada;Telefone 1;Telefone 2;Tel WhatsApp\n';
        
        result.rows.forEach(r => {
            const codRca = r.CODUSUR;
            const nomeVendedor = r.NOME_VENDEDOR ? r.NOME_VENDEDOR.trim() : '';
            const codFilial = r.CODFILIAL ? r.CODFILIAL.trim() : '';
            const filialFormatada = formatFilialName(codFilial, r.NOME_FILIAL ? r.NOME_FILIAL.trim() : '');
            const tel1 = r.TELEFONE1 ? r.TELEFONE1.trim() : '';
            const tel2 = r.TELEFONE2 ? r.TELEFONE2.trim() : '';
            const telWhats = r.PSA_TELWHATS !== null && r.PSA_TELWHATS !== undefined ? String(r.PSA_TELWHATS).trim() : '';

            // Sanitizar ponto e vírgula se houver nos campos de texto
            const cleanNome = nomeVendedor.replace(/;/g, ',');
            const cleanFilial = filialFormatada.replace(/;/g, ',');

            csvContent += `${codRca};${cleanNome};${codFilial};${cleanFilial};${tel1};${tel2};${telWhats}\n`;
        });

        const outputPath = path.join(__dirname, '../vendedores_telefones.csv');
        fs.writeFileSync(outputPath, csvContent, 'utf-8');
        
        console.log(`✅ CSV exportado com sucesso em: ${outputPath}`);
        console.log(`📊 Total de vendedores ativos exportados: ${result.rows.length}`);

        await connection.close();
    } catch (err) {
        console.error('Erro na exportação:', err);
    } finally {
        await db.close();
        process.exit(0);
    }
}

exportToCsv();

require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');

async function main() {
    console.log('🚀 Iniciando teste de query para produtos sem cubagem com estoque da filial 20...');
    await database.initialize();
    const conn = await database.getConnection();
    const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

    try {
        const query = `
            SELECT 
                P.CODPROD,
                P.DESCRICAO,
                P.QTUNITCX,
                P.CODFORNEC,
                (SELECT FANTASIA FROM PCFORNEC WHERE CODFORNEC = P.CODFORNEC) AS FORNECEDOR,
                P.ALTURAM3,
                P.LARGURAM3,
                P.COMPRIMENTOM3,
                NVL((SELECT QTESTGER FROM PCEST WHERE CODPROD = P.CODPROD AND CODFILIAL = '20'), 0) AS ESTOQUE_20,
                NVL((SELECT QTESTGER - QTRESERV - QTBLOQUEADA FROM PCEST WHERE CODPROD = P.CODPROD AND CODFILIAL = '20'), 0) AS ESTOQUE_DISP_20
            FROM PCPRODUT P
            WHERE P.DTEXCLUSAO IS NULL
              AND P.REVENDA = 'S'
              AND P.CODEPTO NOT IN (6, 103)
              AND (
                  P.ALTURAM3 IS NULL OR P.ALTURAM3 = 0
                  OR P.LARGURAM3 IS NULL OR P.LARGURAM3 = 0
                  OR P.COMPRIMENTOM3 IS NULL OR P.COMPRIMENTOM3 = 0
              )
            ORDER BY P.CODFORNEC ASC, P.CODPROD ASC
        `;

        const result = await conn.execute(query, [], opt);
        console.log(`📊 Encontrados ${result.rows.length} produtos sem cubagem.`);
        
        const comEstoque = result.rows.filter(r => r.ESTOQUE_20 > 0);
        const semEstoque = result.rows.filter(r => r.ESTOQUE_20 <= 0);
        
        console.log(`   - Com estoque na filial 20 (QTESTGER > 0): ${comEstoque.length} produtos`);
        console.log(`   - Sem estoque na filial 20: ${semEstoque.length} produtos`);

        if (comEstoque.length > 0) {
            console.log('\nExemplo de produto com estoque na 20:');
            console.log(comEstoque[0]);
        }
        if (semEstoque.length > 0) {
            console.log('\nExemplo de produto sem estoque na 20:');
            console.log(semEstoque[0]);
        }

    } catch (err) {
        console.error('❌ Erro ao processar:', err.message);
    } finally {
        await conn.close();
        await database.close();
    }
}

main();

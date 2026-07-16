require('dotenv').config();
const database = require('../src/config/database');
const logisticsOracleService = require('../src/services/logisticsOracleService');

async function main() {
    await database.initialize();
    try {
        console.log('=== TESTANDO getInterBranchTransfers() ===\n');
        
        // Testar filial 20 + 6
        const transfers = await logisticsOracleService.getInterBranchTransfers('20 + 6');
        console.log(`Filial 20+6: ${transfers.length} itens em trânsito`);
        
        if (transfers.length > 0) {
            console.log('\nPrimeiros 5 itens:');
            transfers.slice(0, 5).forEach(t => {
                console.log(`  Transf. ${t.NUMTRANSVENDA} | ${t.CODFILIALORIGEM} → ${t.CODFILIALDESTINO} | Prod: ${t.CODIGO_PRODUTO} - ${t.DESCRICAO_PRODUTO} | Qtd: ${t.QTTRANSF} | ${t.DIAS_EM_TRANSITO} dias`);
            });
        }
        
        console.log('\n=== AGRUPADO POR NUMTRANSVENDA ===');
        const grouped = {};
        transfers.forEach(t => {
            const key = t.NUMTRANSVENDA;
            if (!grouped[key]) grouped[key] = { itens: 0, caixas: 0, dias: t.DIAS_EM_TRANSITO, origem: t.CODFILIALORIGEM, destino: t.CODFILIALDESTINO };
            grouped[key].itens += t.QTTRANSF;
            grouped[key].caixas += t.QTD_CAIXAS;
        });
        Object.values(grouped).forEach(g => {
            const alert = g.dias >= 7 ? ' ⚠️ ATRASADA' : '';
            console.log(`  Transf. ${Object.keys(grouped).find(k => grouped[k] === g)} | ${g.origem}→${g.destino} | ${g.itens} itens / ${g.caixas.toFixed(1)} cx | ${g.dias} dias em trânsito${alert}`);
        });
        
        console.log('\n✅ Função testada com sucesso!');
    } catch (err) {
        console.error('Erro:', err.message);
    } finally {
        await database.close();
    }
}
main();

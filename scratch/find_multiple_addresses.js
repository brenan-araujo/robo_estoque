require('dotenv').config();
const db = require('../src/config/database');
const oracledb = require('oracledb');

async function main() {
    try {
        await db.initialize();
        const connection = await db.getConnection();

        // Query to find clients with more than one active address in PCCLIENTENDENT
        const query = `
            SELECT 
                c.CODCLI, 
                c.CLIENTE, 
                COUNT(*) as QTD_ENDERECOS
            FROM BRAGO.PCCLIENTENDENT e
            INNER JOIN BRAGO.PCCLIENT c ON e.CODCLI = c.CODCLI
            WHERE e.DTEXCLUSAO IS NULL
            GROUP BY c.CODCLI, c.CLIENTE
            HAVING COUNT(*) > 1
            ORDER BY QTD_ENDERECOS DESC, c.CODCLI
        `;

        const result = await connection.execute(query, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        console.log(`Encontrados ${result.rows.length} clientes com mais de um endereço ativo.`);

        if (result.rows.length > 0) {
            // Let's query the details of these addresses
            const clientIds = result.rows.map(r => r.CODCLI);
            
            // Fetch all active address details for these clients
            // Since there might be many, we can query them together
            const detailQuery = `
                SELECT 
                    e.CODCLI, 
                    e.CODSEQEND, 
                    e.ENDERENT, 
                    e.NUMEROENT, 
                    e.BAIRROENT, 
                    e.MUNICENT, 
                    e.ESTENT, 
                    e.CEPENT,
                    e.ENDERENTPRINC
                FROM BRAGO.PCCLIENTENDENT e
                WHERE e.CODCLI IN (${clientIds.join(',')})
                  AND e.DTEXCLUSAO IS NULL
                ORDER BY e.CODCLI, e.CODSEQEND
            `;
            
            const detailsResult = await connection.execute(detailQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
            
            // Map details to their respective clients
            const clientAddresses = {};
            for (const addr of detailsResult.rows) {
                if (!clientAddresses[addr.CODCLI]) {
                    clientAddresses[addr.CODCLI] = [];
                }
                clientAddresses[addr.CODCLI].push(addr);
            }

            // Output formatting
            console.log('\n=== LISTA DE CLIENTES E SEUS ENDEREÇOS ===\n');
            for (const client of result.rows) {
                console.log(`👤 Cliente: ${client.CODCLI} - ${client.CLIENTE} (${client.QTD_ENDERECOS} endereços)`);
                const addresses = clientAddresses[client.CODCLI] || [];
                for (const addr of addresses) {
                    const isPrincipal = addr.ENDERENTPRINC === 'S' ? ' [PRINCIPAL]' : '';
                    console.log(`   📍 Seq: ${addr.CODSEQEND}${isPrincipal} | Endereço: ${addr.ENDERENT || ''}, ${addr.NUMEROENT || ''} - ${addr.BAIRROENT || ''}, ${addr.MUNICENT || ''}/${addr.ESTENT || ''} - CEP: ${addr.CEPENT || ''}`);
                }
                console.log('-'.repeat(80));
            }
        }

        await connection.close();
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await db.close();
        process.exit(0);
    }
}

main();

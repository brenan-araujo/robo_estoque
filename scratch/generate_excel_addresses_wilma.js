require('dotenv').config();
const db = require('../src/config/database');
const oracledb = require('oracledb');
const ExcelJS = require('exceljs');
const path = require('path');

async function main() {
    try {
        await db.initialize();
        const connection = await db.getConnection();

        // 1. Query to find clients of Wilma (CODUSUR = 15) with more than one active address in PCCLIENTENDENT
        const queryClients = `
            SELECT 
                c.CODCLI, 
                c.CLIENTE, 
                c.CODUSUR1 AS RCA,
                u.NOME AS NOME_RCA,
                COUNT(*) as QTD_ENDERECOS
            FROM BRAGO.PCCLIENTENDENT e
            INNER JOIN BRAGO.PCCLIENT c ON e.CODCLI = c.CODCLI
            INNER JOIN BRAGO.PCUSUARI u ON c.CODUSUR1 = u.CODUSUR
            WHERE e.DTEXCLUSAO IS NULL
              AND c.CODUSUR1 = 15
            GROUP BY c.CODCLI, c.CLIENTE, c.CODUSUR1, u.NOME
            HAVING COUNT(*) > 1
            ORDER BY c.CODCLI
        `;

        const resultClients = await connection.execute(queryClients, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const totalClients = resultClients.rows.length;
        console.log(`Encontrados ${totalClients} clientes da Wilma Gomes com mais de um endereço ativo.`);

        if (totalClients === 0) {
            console.log('Nenhum cliente encontrado.');
            await connection.close();
            return;
        }

        const clientIds = resultClients.rows.map(r => r.CODCLI);

        // 2. Fetch all active address details for these clients
        const detailQuery = `
            SELECT 
                e.CODCLI, 
                c.CLIENTE,
                e.CODSEQEND, 
                e.ENDERENT, 
                e.NUMEROENT, 
                e.BAIRROENT, 
                e.MUNICENT, 
                e.ESTENT, 
                e.CEPENT,
                e.ENDERENTPRINC
            FROM BRAGO.PCCLIENTENDENT e
            INNER JOIN BRAGO.PCCLIENT c ON e.CODCLI = c.CODCLI
            WHERE e.CODCLI IN (${clientIds.join(',')})
              AND e.DTEXCLUSAO IS NULL
            ORDER BY e.CODCLI, e.CODSEQEND
        `;
        const detailsResult = await connection.execute(detailQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });

        console.log(`Total de endereços a serem exportados: ${detailsResult.rows.length}`);

        // 3. Map details to their respective clients for console output
        const clientAddresses = {};
        for (const addr of detailsResult.rows) {
            if (!clientAddresses[addr.CODCLI]) {
                clientAddresses[addr.CODCLI] = [];
            }
            clientAddresses[addr.CODCLI].push(addr);
        }

        // Output formatting for console
        console.log('\n=== LISTA DE CLIENTES DA WILMA E SEUS ENDEREÇOS ===\n');
        for (const client of resultClients.rows) {
            console.log(`👤 Cliente: ${client.CODCLI} - ${client.CLIENTE} (${client.QTD_ENDERECOS} endereços)`);
            const addresses = clientAddresses[client.CODCLI] || [];
            for (const addr of addresses) {
                const isPrincipal = addr.ENDERENTPRINC === 'S' ? ' [PRINCIPAL]' : '';
                console.log(`   📍 Seq: ${addr.CODSEQEND}${isPrincipal} | Endereço: ${addr.ENDERENT || ''}, ${addr.NUMEROENT || ''} - ${addr.BAIRROENT || ''}, ${addr.MUNICENT || ''}/${addr.ESTENT || ''} - CEP: ${addr.CEPENT || ''}`);
            }
            console.log('-'.repeat(80));
        }

        // 4. Create Excel Workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Antigravity AI';
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet('Clientes Wilma');

        // Add headers
        worksheet.columns = [
            { header: 'Cód. Cliente', key: 'CODCLI', width: 12 },
            { header: 'Nome Cliente', key: 'CLIENTE', width: 45 },
            { header: 'Seq. Endereço', key: 'CODSEQEND', width: 15 },
            { header: 'Principal?', key: 'ENDERENTPRINC', width: 12 },
            { header: 'CEP', key: 'CEPENT', width: 12 },
            { header: 'UF', key: 'ESTENT', width: 8 },
            { header: 'Cidade', key: 'MUNICENT', width: 25 },
            { header: 'Bairro', key: 'BAIRROENT', width: 25 },
            { header: 'Endereço', key: 'ENDERENT', width: 40 },
            { header: 'Número', key: 'NUMEROENT', width: 10 }
        ];

        // Format header row
        const headerRow = worksheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF1F4E78' } // Dark blue header
        };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
        headerRow.height = 25;

        // Add rows
        detailsResult.rows.forEach(row => {
            worksheet.addRow({
                CODCLI: row.CODCLI,
                CLIENTE: row.CLIENTE,
                CODSEQEND: row.CODSEQEND,
                ENDERENTPRINC: row.ENDERENTPRINC === 'S' ? 'Sim' : 'Não',
                CEPENT: row.CEPENT,
                ESTENT: row.ESTENT,
                MUNICENT: row.MUNICENT,
                BAIRROENT: row.BAIRROENT,
                ENDERENT: row.ENDERENT,
                NUMEROENT: row.NUMEROENT
            });
        });

        // Set alignment for specific columns
        worksheet.getColumn('CODCLI').alignment = { horizontal: 'center' };
        worksheet.getColumn('CODSEQEND').alignment = { horizontal: 'center' };
        worksheet.getColumn('ENDERENTPRINC').alignment = { horizontal: 'center' };
        worksheet.getColumn('CEPENT').alignment = { horizontal: 'center' };
        worksheet.getColumn('ESTENT').alignment = { horizontal: 'center' };

        // Save file
        const filename = 'clientes_multiplos_enderecos_wilma.xlsx';
        const outputPath = path.join(__dirname, '..', filename);
        await workbook.xlsx.writeFile(outputPath);
        console.log(`Planilha salva com sucesso em: ${outputPath}`);

        await connection.close();
    } catch (err) {
        console.error('Erro:', err);
    } finally {
        await db.close();
        process.exit(0);
    }
}

main();

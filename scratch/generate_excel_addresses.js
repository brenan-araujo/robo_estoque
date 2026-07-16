require('dotenv').config();
const db = require('../src/config/database');
const oracledb = require('oracledb');
const ExcelJS = require('exceljs');
const path = require('path');

async function main() {
    try {
        await db.initialize();
        const connection = await db.getConnection();

        // 1. Query to find clients with more than one active address in PCCLIENTENDENT
        const queryClients = `
            SELECT 
                c.CODCLI, 
                c.CLIENTE, 
                COUNT(*) as QTD_ENDERECOS
            FROM BRAGO.PCCLIENTENDENT e
            INNER JOIN BRAGO.PCCLIENT c ON e.CODCLI = c.CODCLI
            WHERE e.DTEXCLUSAO IS NULL
            GROUP BY c.CODCLI, c.CLIENTE
            HAVING COUNT(*) > 1
            ORDER BY c.CODCLI
        `;

        const resultClients = await connection.execute(queryClients, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
        const totalClients = resultClients.rows.length;
        console.log(`Encontrados ${totalClients} clientes com mais de um endereço ativo.`);

        if (totalClients === 0) {
            console.log('Nenhum cliente encontrado.');
            await connection.close();
            return;
        }

        const clientIds = resultClients.rows.map(r => r.CODCLI);

        // 2. Fetch all active address details for these clients
        // Oracle has a limit on IN list size (1000 items). Let's chunk the query if needed.
        let detailsRows = [];
        const chunkSize = 900;
        for (let i = 0; i < clientIds.length; i += chunkSize) {
            const chunk = clientIds.slice(i, i + chunkSize);
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
                WHERE e.CODCLI IN (${chunk.join(',')})
                  AND e.DTEXCLUSAO IS NULL
                ORDER BY e.CODCLI, e.CODSEQEND
            `;
            const chunkResult = await connection.execute(detailQuery, [], { outFormat: oracledb.OUT_FORMAT_OBJECT });
            detailsRows = detailsRows.concat(chunkResult.rows);
        }

        console.log(`Total de endereços a serem exportados: ${detailsRows.length}`);

        // 3. Create Excel Workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Antigravity AI';
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet('Clientes Multi-Endereço');

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

        // Add rows and format them
        detailsRows.forEach(row => {
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
        const filename = 'clientes_multiplos_enderecos.xlsx';
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

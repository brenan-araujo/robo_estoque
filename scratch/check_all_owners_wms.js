require('dotenv').config({ path: 'c:/Users/usuario001/Documents/api_consulta_estoque/.env' });
const { initialize, getConnection, close } = require('c:/Users/usuario001/Documents/api_consulta_estoque/src/config/database');
const oracledb = require('oracledb');

async function main() {
    try {
        await initialize();
        const conn = await getConnection();
        const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };

        console.log("=== SCANNING FOR WMS TABLES IN ALL SCHEMAS ===");
        const res = await conn.execute(`
            SELECT OWNER, TABLE_NAME 
            FROM ALL_TABLES 
            WHERE TABLE_NAME LIKE '%WMS%'
              AND OWNER NOT IN ('SYS', 'SYSTEM', 'OUTLN', 'DBSNMP', 'APPQOSSYS', 'WMSYS', 'OJSYS', 'ORDDATA', 'ORDSYS', 'MDSYS', 'CTXSYS', 'XDB', 'ANONYMOUS', 'APEX_040200')
            ORDER BY OWNER, TABLE_NAME
        `, [], opt);

        console.log(`Found ${res.rows.length} tables in various schemas.`);
        
        // Group by owner
        const grouped = {};
        res.rows.forEach(r => {
            grouped[r.OWNER] = (grouped[r.OWNER] || 0) + 1;
        });
        
        console.log("\nTable count per schema:");
        console.table(Object.entries(grouped).map(([schema, count]) => ({ Schema: schema, "Table Count": count })));

        console.log("\nSample WMS tables per schema:");
        const samples = {};
        res.rows.forEach(r => {
            if (!samples[r.OWNER]) samples[r.OWNER] = [];
            if (samples[r.OWNER].length < 3) samples[r.OWNER].push(r.TABLE_NAME);
        });
        console.log(samples);

        await conn.close();
        await close();
    } catch (err) {
        console.error(err);
    }
}
main();

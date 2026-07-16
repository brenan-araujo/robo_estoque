require('dotenv').config();
const database = require('../src/config/database');
(async()=>{
  await database.initialize();
  try {
    const svc = require('../src/services/weeklyGoalsReportService');
    const r = await svc.runWeeklyGoalsReport(true);
    console.log(JSON.stringify(r, null, 2));
  } catch(e){ console.error('ERRO:', e.message); console.error(e.stack); }
  finally { await database.close(); }
})();

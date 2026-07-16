require('dotenv').config();
const database = require('../src/config/database');
const { oracledb } = require('../src/config/database');
(async()=>{
  await database.initialize();
  const conn = await database.getConnection();
  const opt = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  // familia: raiz -> membros [cod, fator(QTUNIT)]
  const familias = {
    '16799 FIBRA VERDE':  [[16799,10],[18604,1]],
    '16801 FIBRA BRANCA': [[16801,10],[18605,1]],
    '18261 ESPONJA':      [[18261,10],[18617,1]],
    '17776 PAPEL HIG':    [[17776,16],[18609,1]],
  };
  const FIL = "'21'"; // foco filial 21
  const J = 90, PRAZO_PAD = 15;

  for (const [nome, membros] of Object.entries(familias)) {
    const cods = membros.map(m=>m[0]);
    // estoque disp por produto (filial 21)
    const est = await conn.execute(
      `SELECT CODPROD, NVL(SUM(NVL(QTESTGER,0)-NVL(QTRESERV,0)-NVL(QTBLOQUEADA,0)),0) DISP
       FROM PCEST WHERE CODPROD IN (${cods.join(',')}) AND CODFILIAL=21 GROUP BY CODPROD`,[],opt);
    const vnd = await conn.execute(
      `SELECT CODPROD, NVL(SUM(QT-NVL(QTDEVOL,0)),0) LIQ, COUNT(DISTINCT TRUNC(DTMOV)) DIAS
       FROM PCMOV WHERE CODPROD IN (${cods.join(',')}) AND CODOPER='S' AND DTMOV>=TRUNC(SYSDATE)-${J}
         AND CODFILIAL IN ('21') GROUP BY CODPROD`,[],opt);
    const estMap={}, vndMap={}, diasMap={};
    est.rows.forEach(r=>estMap[r.CODPROD]=Number(r.DISP));
    vnd.rows.forEach(r=>{vndMap[r.CODPROD]=Number(r.LIQ); diasMap[r.CODPROD]=Number(r.DIAS);});

    let baseStock=0, baseSales=0;
    const detalhe=[];
    membros.forEach(([cod,fator])=>{
      const s=(estMap[cod]||0), v=(vndMap[cod]||0);
      baseStock += s*fator; baseSales += v*fator;
      detalhe.push(`${cod}(x${fator}): est ${s} -> ${s*fator}un | vendas90d ${v} -> ${v*fator}un`);
    });
    const vdaBase = baseSales/J;
    const cob = vdaBase>0 ? (baseStock/vdaBase) : 9999;
    // filho sozinho (o de fator 1)
    const filho = membros.find(m=>m[1]===1)[0];
    const sFilho=estMap[filho]||0, vFilho=vndMap[filho]||0, vdaFilho=vFilho/J;
    const cobFilho = vdaFilho>0 ? sFilho/vdaFilho : 9999;

    console.log(`\n===== ${nome} (filial 21) =====`);
    detalhe.forEach(d=>console.log('  '+d));
    console.log(`  >> FAMÍLIA: estoque ${baseStock} un | venda ${vdaBase.toFixed(1)}/dia | cobertura ${cob.toFixed(0)} dias -> ${cob>=PRAZO_PAD?'SAUDAVEL':'CRITICO'}`);
    console.log(`  >> FILHO ${filho} SOZINHO (hoje): estoque ${sFilho} un | venda ${vdaFilho.toFixed(1)}/dia | cobertura ${cobFilho.toFixed(1)} dias -> ${cobFilho>=PRAZO_PAD?'SAUDAVEL':'CRITICO'}`);
  }
  await conn.close(); await database.close();
})();

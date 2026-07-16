const getFirstName = (fullName) => {
    if (!fullName) return 'vendedor';
    const firstWord = fullName.trim().split(/\s+/)[0];
    return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
};

// Mock matched cuts data
const matchedCuts = [
    {
        NUMPED: '1003020916',
        CODCLI: '26854',
        CLIENTE: 'FORMPAN INDUSTRIA DE PAO LTDA',
        RCA: '3',
        NOME_RCA: 'ALBINO VALADAO',
        CODFILIAL: '20',
        CODPROD: '1361',
        DESCRICAO: 'PRATO P/BOLO MP28 C/BORDA C/200 UN',
        QT_FALTA: 6,
        qtDisp: 10
    },
    {
        NUMPED: '1003020916',
        CODCLI: '26854',
        CLIENTE: 'FORMPAN INDUSTRIA DE PAO LTDA',
        RCA: '3',
        NOME_RCA: 'ALBINO VALADAO',
        CODFILIAL: '20',
        CODPROD: '1420',
        DESCRICAO: 'COPO DESCARTAVEL 200ML',
        QT_FALTA: 10,
        qtDisp: 50
    },
    {
        NUMPED: '1003020925',
        CODCLI: '31500',
        CLIENTE: 'SUPERMERCADO DO POVO',
        RCA: '3',
        NOME_RCA: 'ALBINO VALADAO',
        CODFILIAL: '20',
        CODPROD: '2510',
        DESCRICAO: 'GUARDANAPO DE PAPEL 30X30',
        QT_FALTA: 2,
        qtDisp: 15
    }
];

// Perform the grouping logic
const groupedByRca = {};
for (const cut of matchedCuts) {
    const rca = String(cut.RCA).trim();
    if (!groupedByRca[rca]) {
        groupedByRca[rca] = {
            rca: rca,
            nome_rca: cut.NOME_RCA,
            pedidos: {}
        };
    }

    const numPed = String(cut.NUMPED);
    if (!groupedByRca[rca].pedidos[numPed]) {
        groupedByRca[rca].pedidos[numPed] = {
            numped: numPed,
            codcli: cut.CODCLI,
            cliente: cut.CLIENTE,
            codfilial: cut.CODFILIAL,
            items: []
        };
    }

    if (!groupedByRca[rca].pedidos[numPed].items.some(i => i.codprod === cut.CODPROD)) {
        groupedByRca[rca].pedidos[numPed].items.push({
            codprod: cut.CODPROD,
            descricao: cut.DESCRICAO,
            qt_falta: cut.QT_FALTA,
            qtDisp: cut.qtDisp
        });
    }
}

// Generate the message and print it
for (const [rca, group] of Object.entries(groupedByRca)) {
    const firstName = getFirstName(group.nome_rca);

    const ordersBlocks = [];
    for (const ped of Object.values(group.pedidos)) {
        const itemsList = ped.items.map(item => {
            return `${item.codprod} - ${item.descricao} (Qtd: ${item.qt_falta}) \n  - *Estq Disp: ${item.qtDisp}un*`;
        }).join('\n');

        const block = `👤 *Cliente:* ${ped.codcli} - ${ped.cliente} \n📝 *Pedido:* ${ped.numped} \n\n📦 *Itens do corte:* \n\n${itemsList}`;
        ordersBlocks.push(block);
    }

    const message = `✨ *Corte Resolvido* ✨ \n\nOiee! ${firstName}. \nOs produtos que estavam em corte chegaram! 🎉\n\n${ordersBlocks.join('\n\n──────────────────────────\n\n')}`;
    
    console.log(`=== Message for RCA ${rca} (${group.nome_rca}) ===`);
    console.log(message);
    console.log('==================================================');
}

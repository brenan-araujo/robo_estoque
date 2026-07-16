const getFirstName = (fullName) => {
    if (!fullName) return 'vendedor';
    const firstWord = fullName.trim().split(/\s+/)[0];
    return firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
};

const escapeHTML = (text) => {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
};

// Filtered real Oracle cuts for Denise Braga where Stock Available >= Cut Quantity
const matchedCuts = [
    {
        NUMPED: '27029709',
        CODCLI: '36019',
        CLIENTE: 'GRUPO FARTURA DE HORTIFRUT S.A.',
        RCA: '27',
        NOME_RCA: 'DENISE BRAGA',
        CODFILIAL: '20',
        CODPROD: '17979',
        DESCRICAO: 'SUPORTE LIMPA TUDO ARTICULADO CINZA TTS',
        QT_FALTA: 1,
        qtDisp: 2
    },
    {
        NUMPED: '27029710',
        CODCLI: '36019',
        CLIENTE: 'GRUPO FARTURA DE HORTIFRUT S.A.',
        RCA: '27',
        NOME_RCA: 'DENISE BRAGA',
        CODFILIAL: '20',
        CODPROD: '17979',
        DESCRICAO: 'SUPORTE LIMPA TUDO ARTICULADO CINZA TTS',
        QT_FALTA: 2,
        qtDisp: 2
    },
    {
        NUMPED: '27029732',
        CODCLI: '33748',
        CLIENTE: 'BIG TRANS COMERCIAL DE ALIMENTOS S/A',
        RCA: '27',
        NOME_RCA: 'DENISE BRAGA',
        CODFILIAL: '20',
        CODPROD: '673',
        DESCRICAO: 'BAND M58 BRANCA C/400',
        QT_FALTA: 2,
        qtDisp: 145
    },
    {
        NUMPED: '27029734',
        CODCLI: '34741',
        CLIENTE: 'ANGELICA COMERCIAL DE ALIMENTOS S/A',
        RCA: '27',
        NOME_RCA: 'DENISE BRAGA',
        CODFILIAL: '20',
        CODPROD: '673',
        DESCRICAO: 'BAND M58 BRANCA C/400',
        QT_FALTA: 2,
        qtDisp: 145
    },
    {
        NUMPED: '27029739',
        CODCLI: '36749',
        CLIENTE: 'LAGO SUL COMERCIAL DE ALIMENTOS S/A',
        RCA: '27',
        NOME_RCA: 'DENISE BRAGA',
        CODFILIAL: '20',
        CODPROD: '673',
        DESCRICAO: 'BAND M58 BRANCA C/400',
        QT_FALTA: 1,
        qtDisp: 145
    },
    {
        NUMPED: '27029743',
        CODCLI: '55347',
        CLIENTE: 'BIG TRANS COMERCIAL DE ALIMENTOS LTDA',
        RCA: '27',
        NOME_RCA: 'DENISE BRAGA',
        CODFILIAL: '20',
        CODPROD: '673',
        DESCRICAO: 'BAND M58 BRANCA C/400',
        QT_FALTA: 2,
        qtDisp: 145
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
    
    console.log(message);
}

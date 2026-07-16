const contactsManager = require('../src/utils/contactsManager');

const filialNameMap = {
    '20 + 6': 'Comercial Brasília',
    '21': 'Comercial Goiânia',
    '22': 'Comercial TO',
    '23': 'Comercial MS'
};

function generateMessage(filialName) {
    return `Olá, ${filialName}! 😊

Passando para dar um "oi" e dizer que agora estou oficialmente no grupo de vocês! 🌟

Minha missão aqui é somar, trazer novidades e facilitar a comunicação de vocês. Contem comigo para apoiar a equipe no que for preciso!

Vamos juntos rumo a grandes resultados e crescer cada vez mais! Boas vendas! 🚀📈`;
}

try {
    const contacts = contactsManager.getContacts();
    const groups = contacts.filter(c => c.role === 'grupo');
    
    console.log('📋 PREVIEW DAS MENSAGENS POR GRUPO:\n');
    groups.forEach(g => {
        const filialLabel = filialNameMap[g.filial] || g.filial;
        const msg = generateMessage(filialLabel);
        console.log(`=========================================`);
        console.log(`👥 Grupo WhatsApp: "${g.name}"`);
        console.log(`📍 Filial Mapeada: ${g.filial} (${filialLabel})`);
        console.log(`-----------------------------------------`);
        console.log(msg);
        console.log(`=========================================\n`);
    });
} catch (e) {
    console.error('Erro:', e.message);
}

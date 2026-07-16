const contactsManager = require('../src/utils/contactsManager');

console.log('🔄 Executando atualização de contatos para injetar os grupos padrão...');
try {
    const list = contactsManager.getContacts();
    console.log('✅ Contatos carregados e processados com sucesso. Total:', list.length);
    console.log('Lista de Grupos injetados/existentes:');
    console.table(list.filter(c => c.role === 'grupo').map(c => ({ Name: c.name, Filial: c.filial })));
} catch (e) {
    console.error('❌ Erro:', e.message);
}

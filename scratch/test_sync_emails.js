require('dotenv').config();
const db = require('../src/config/database');
const contactsSyncService = require('../src/services/contactsSyncService');
const fs = require('fs');
const path = require('path');

async function testSync() {
    console.log('🧪 Iniciando teste de sincronização de e-mails com banco de dados...');
    try {
        // Inicializar banco
        await db.initialize();
        
        // Executar sincronização
        await contactsSyncService.syncContactsWithOracle();
        
        // Ler contacts.json atualizado
        const contactsFile = path.join(__dirname, '..', 'data', 'contacts.json');
        if (fs.existsSync(contactsFile)) {
            const contacts = JSON.parse(fs.readFileSync(contactsFile, 'utf8'));
            console.log('\n=== Resultados da Sincronização (Amostra de Vendedores com E-mail) ===');
            const withEmails = contacts.filter(c => c.email);
            
            console.log(`Total de contatos: ${contacts.length}`);
            console.log(`Contatos com e-mail cadastrado: ${withEmails.length}`);
            
            withEmails.slice(0, 10).forEach(c => {
                console.log(`- ${c.name} (RCA: ${c.rcaCode}) | Fone: ${c.phone} | E-mail: ${c.email}`);
            });
        } else {
            console.error('Arquivo contacts.json não foi encontrado após o sync!');
        }

    } catch (err) {
        console.error('Erro durante o teste de sincronização:', err);
    } finally {
        await db.close();
        console.log('🧪 Teste finalizado.');
        process.exit(0);
    }
}

testSync();

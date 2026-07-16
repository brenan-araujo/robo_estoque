const fs = require('fs');
const path = require('path');

const contactsPath = path.join(__dirname, '..', 'data', 'contacts.json');
if (fs.existsSync(contactsPath)) {
    const contacts = JSON.parse(fs.readFileSync(contactsPath, 'utf8'));
    console.log('--- ALL ADMINS AND CONTACTS WITH BRENAN OR ARAUJO ---');
    contacts.forEach(c => {
        const nameLower = c.name.toLowerCase();
        if (nameLower.includes('brenan') || nameLower.includes('araujo') || nameLower.includes('araújo') || c.role === 'admin') {
            console.log(`ID: ${c.id} | Name: ${c.name} | Phone: ${c.phone} | Role: ${c.role}`);
        }
    });
} else {
    console.log('contacts.json does not exist');
}

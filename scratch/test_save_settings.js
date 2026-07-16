const fs = require('fs');
const path = require('path');
const http = require('http');

const settingsPath = path.join(__dirname, '..', 'data', 'settings.json');

// Read the original settings file so we can restore it later
const originalSettingsStr = fs.readFileSync(settingsPath, 'utf8');
const originalSettings = JSON.parse(originalSettingsStr);

console.log('Original Settings notifyNumbers:', originalSettings.notifyNumbers);

const testPayload = {
    pollIntervalMinutes: originalSettings.pollIntervalMinutes,
    notifyNumbers: ['5561983391951', '5561998097323'], // Mocked selection
    pdfNotifyNumbers: ['5561983391951', '5561999797868'], // Mocked selection
    salesPdfNotifyNumbers: ['5561983391951'], // Mocked selection
    filialGroups: originalSettings.filialGroups,
    filialNumbers: originalSettings.filialNumbers
};

const postData = JSON.stringify(testPayload);

const reqOptions = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/settings',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
    }
};

console.log('Sending test payload to update settings...');

const req = http.request(reqOptions, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        console.log(`Response status: ${res.statusCode}`);
        
        // Read the settings from settings.json
        const updatedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        console.log('Updated Settings notifyNumbers:', updatedSettings.notifyNumbers);
        console.log('Updated Settings pdfNotifyNumbers:', updatedSettings.pdfNotifyNumbers);
        console.log('Updated Settings salesPdfNotifyNumbers:', updatedSettings.salesPdfNotifyNumbers);

        // Verification Assertions
        const successNotify = JSON.stringify(updatedSettings.notifyNumbers) === JSON.stringify(testPayload.notifyNumbers);
        const successPdf = JSON.stringify(updatedSettings.pdfNotifyNumbers) === JSON.stringify(testPayload.pdfNotifyNumbers);
        const successSalesPdf = JSON.stringify(updatedSettings.salesPdfNotifyNumbers) === JSON.stringify(testPayload.salesPdfNotifyNumbers);

        if (successNotify && successPdf && successSalesPdf) {
            console.log('✅ Settings saved and verified successfully!');
        } else {
            console.error('❌ Settings mismatch! Test failed.');
        }

        // Restore original settings
        fs.writeFileSync(settingsPath, originalSettingsStr, 'utf8');
        console.log('Restored original settings to settings.json.');
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
    // Restore original settings just in case
    fs.writeFileSync(settingsPath, originalSettingsStr, 'utf8');
});

req.write(postData);
req.end();

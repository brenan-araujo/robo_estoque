const http = require('http');

http.get('http://localhost:3001/api/funnel-products', (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const list = JSON.parse(data);
            console.log(`API respondeu com ${list.length} itens.`);
            const p17321 = list.find(p => p.CODPROD === 17321);
            if (p17321) {
                console.log('✅ Sucesso! Produto 17321 retornado na API:');
                console.log(JSON.stringify(p17321, null, 2));
            } else {
                console.log('❌ Erro! Produto 17321 não foi encontrado na API.');
            }
        } catch (e) {
            console.error('Erro ao fazer parse dos dados:', e.message);
            console.log('Resposta bruta:', data.substring(0, 200));
        }
    });
}).on('error', (err) => {
    console.log('A API do servidor local não está respondendo. O servidor pode estar desligado.');
    console.log('Erro:', err.message);
});

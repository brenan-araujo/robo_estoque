const fs = require('fs');
const path = require('path');

const productUrls = [
  "https://softworksepi.com.br/produtos/bota-cano-curto-com-biqueira-bb84/",
  "https://softworksepi.com.br/produtos/tenis-soft-bb82/",
  "https://softworksepi.com.br/produtos/tenis-unisex-bb80/",
  "https://softworksepi.com.br/produtos/sapato-unisex-bb65/",
  "https://softworksepi.com.br/produtos/tamanco-bb60/",
  "https://softworksepi.com.br/produtos/bota-cano-curto-bb85/",
  "https://softworksepi.com.br/produtos/sapato-feminino-bb95/",
  "https://softworksepi.com.br/produtos/bota-cano-longo-com-biqueira-bb86/",
  "https://softworksepi.com.br/produtos/sapatenis-unisex-bb81/",
  "https://softworksepi.com.br/produtos/sapato-social-bb67/",
  "https://softworksepi.com.br/produtos/sapato-tipo-tamanco-bb61/",
  "https://softworksepi.com.br/produtos/sapato-com-biqueira-bb66/",
  "https://softworksepi.com.br/produtos/babuch-bb31/",
  "https://softworksepi.com.br/produtos/bota-cano-longo-bb87/",
  "https://softworksepi.com.br/produtos/sapatilha-bb50/",
  "https://softworksepi.com.br/produtos/tamanco-com-palmilha-bb900/",
  "https://softworksepi.com.br/produtos/sapato-tipo-sapatilha-bb50/",
  "https://softworksepi.com.br/produtos/babuch-c-estampa-bb32/",
  "https://softworksepi.com.br/produtos/babuch-c-pelo-bb33/",
  "https://softworksepi.com.br/produtos/sapatilha-com-revirao-bb59/",
  "https://softworksepi.com.br/produtos/babuch-c-estampa-e-pelo-bb34/"
];

async function scrapePage(url) {
  console.log(`Scraping: ${url}...`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    
    // 1. Model & Reference
    let model = null;
    let ref = null;
    let ca = null;
    
    // Try matching: Ref. BB80 | CA 37.212
    const refMatch = html.match(/Ref\.\s*([A-Za-z0-9]+)\s*\|\s*CA\s*([0-9.]+)/i);
    if (refMatch) {
      model = refMatch[1].trim();
      ref = `Ref. ${model}`;
      ca = refMatch[2].trim();
    } else {
      // Fallback: extract model from slug
      const slugMatch = url.match(/-([a-z0-9]+)\/?$/);
      if (slugMatch) {
        model = slugMatch[1].toUpperCase();
      }
    }
    
    // 2. Name
    let name = '';
    const nameMatch = html.match(/<h1 class="name">([^<]+)<\/h1>/i);
    if (nameMatch) {
      name = nameMatch[1].trim();
    }
    
    // 3. Sizing Grade
    let grade = '';
    const gradeMatch = html.match(/<p class="grade">([^<]+)<\/p>/i);
    if (gradeMatch) {
      grade = gradeMatch[1].trim();
    }
    
    // 4. Differentials
    const differentials = [];
    const diffRegex = /<li class="item">.*?<\/img>(.*?)<\/li>/gi;
    let match;
    while ((match = diffRegex.exec(html)) !== null) {
      differentials.push(match[1].trim());
    }
    
    // 5. Technical Specifications
    let specs = '';
    const specsMatch = html.match(/id="especificacoesTecnicasTitulo"[\s\S]*?<div class="card-body">([\s\S]*?)<\/div>/i);
    if (specsMatch) {
      specs = specsMatch[1].replace(/<[^>]+>/g, '').trim();
    }
    
    // 6. Solado SRC
    let solado = '';
    const soladoMatch = html.match(/id="soladoAntiderrapanteTitulo"[\s\S]*?<div class="card-body">([\s\S]*?)<\/div>/i);
    if (soladoMatch) {
      solado = soladoMatch[1].replace(/<[^>]+>/g, '').trim();
    }
    
    // 7. PDF links (Ficha tecnica, CA, CE, IBETEC)
    let fichaPdf = '';
    let caPdf = '';
    let cePdf = '';
    let ibetecPdf = '';
    
    const pdfRegex = /href="([^"]+\.pdf)"/gi;
    let pdfMatch;
    while ((pdfMatch = pdfRegex.exec(html)) !== null) {
      const pdfUrl = pdfMatch[1];
      const lowerPdf = pdfUrl.toLowerCase();
      if (lowerPdf.includes('politica')) continue; // Skip privacy/cookie policies
      
      if (lowerPdf.includes('ficha-tecnica') || lowerPdf.includes('fichatecnica')) {
        fichaPdf = pdfUrl;
      } else if (lowerPdf.includes('ca-n') || lowerPdf.includes('ca_n') || lowerPdf.includes('ca-') || lowerPdf.includes('certificado-de-aprovacao')) {
        caPdf = pdfUrl;
      } else if (lowerPdf.includes('satra') || lowerPdf.includes('certificado-europeu') || pdfUrl.match(/[0-9]{10}/)) {
        cePdf = pdfUrl;
      } else {
        ibetecPdf = pdfUrl; // general fallback
      }
    }
    
    // 8. Colors from Gallery
    const colors = new Set();
    const colorRegex = /<span class="desc">([^<]+)<\/span>/gi;
    let colorMatch;
    while ((colorMatch = colorRegex.exec(html)) !== null) {
      colors.add(colorMatch[1].trim().toUpperCase());
    }
    
    return {
      url,
      model,
      ref,
      ca,
      name,
      grade,
      differentials: differentials.join(', '),
      specs,
      solado,
      fichaPdf,
      caPdf,
      cePdf,
      ibetecPdf,
      colors: Array.from(colors)
    };
  } catch (err) {
    console.error(`Failed to scrape ${url}:`, err.message);
    return { url, error: err.message };
  }
}

async function main() {
  const results = [];
  for (const url of productUrls) {
    const data = await scrapePage(url);
    results.push(data);
    // Add small delay to avoid hammering the server
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  const outputPath = path.join(__dirname, 'softworks_scraped.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nSuccessfully scraped ${results.length} pages.`);
  console.log(`Saved to ${outputPath}`);
}

main();

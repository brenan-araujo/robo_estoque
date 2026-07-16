const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\usuario001\\.gemini\\antigravity-ide\\brain\\e3073dc2-1408-4555-b531-853c9fccd8a1\\.system_generated\\logs\\transcript_full.jsonl';

try {
  const fileContent = fs.readFileSync(logPath, 'utf8');
  const lines = fileContent.split('\n');
  if (lines.length > 0 && lines[0].trim()) {
    const parsed = JSON.parse(lines[0]);
    const fullContent = parsed.content;
    
    // Find where the view content starts
    const index = fullContent.indexOf('view_vendas_resumo_faturam');
    if (index !== -1) {
      const viewPart = fullContent.substring(index);
      fs.writeFileSync('c:\\Users\\usuario001\\Documents\\api_consulta_estoque\\scratch\\view_definition.txt', viewPart, 'utf8');
      console.log("Successfully extracted view definition to scratch/view_definition.txt. Size:", viewPart.length, "bytes.");
    } else {
      console.log("Could not find 'view_vendas_resumo_faturam' in full content.");
      // Just write the whole content so we can read it
      fs.writeFileSync('c:\\Users\\usuario001\\Documents\\api_consulta_estoque\\scratch\\view_definition.txt', fullContent, 'utf8');
      console.log("Wrote full content instead.");
    }
  } else {
    console.log("No lines found.");
  }
} catch (e) {
  console.error("Error:", e.message);
}

const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\usuario001\\.gemini\\antigravity-ide\\brain\\e3073dc2-1408-4555-b531-853c9fccd8a1\\.system_generated\\logs\\transcript_full.jsonl';

try {
  const fileContent = fs.readFileSync(logPath, 'utf8');
  const lines = fileContent.split('\n');
  if (lines.length > 0 && lines[0].trim()) {
    const parsed = JSON.parse(lines[0]);
    console.log("=== FULL CONTENT START ===");
    console.log(parsed.content);
    console.log("=== FULL CONTENT END ===");
  } else {
    console.log("No lines found.");
  }
} catch (e) {
  console.error("Error:", e.message);
}

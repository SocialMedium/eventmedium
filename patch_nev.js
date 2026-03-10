const fs = require('fs');
let nev = fs.readFileSync('routes/nev.js', 'utf8');

const oldExtract = `    var data = await resp.json();
    var reply = data.content[0].text;

    // Extract canister data
    var canisterData = null;
    var canisterMatch = reply.match(/\\[CANISTER_READY\\]([\\s\\S]*?)\\[\\/CANISTER_READY\\]/);
    if (canisterMatch) {
      try {
        canisterData = JSON.parse(canisterMatch[1].trim());`;

const newExtract = `    var data = await resp.json();
    var reply = data.content[0].text;
    reply = reply.replace(/\\[CANISTER_READY\\][\\s\\S]*?\\[\\/CANISTER_READY\\]/, '').trim();

    // ── Second call: extract canister data independently ──
    var canisterData = null;
    try {
      var extractResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: MODEL,
          system: 'Extract profile data from this conversation as JSON. Return ONLY a valid JSON object with these exact keys: stakeholder_type (one of: founder/investor/researcher/corporate/advisor/operator or empty string), themes (array of strings), intent (array of strings), offering (array of strings), context (string), geography (string), deal_details (object). No explanation, no markdown, just the raw JSON object.',
          messages: [...anthropicMessages, { role: 'assistant', content: reply }],
          max_tokens: 300,
          temperature: 0
        })
      });
      if (extractResp.ok) {
        var extractData = await extractResp.json();
        var extractText = extractData.content[0].text.trim();
        extractText = extractText.replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
        canisterData = JSON.parse(extractText);
        if (canisterData.themes) canisterData.themes = normalizeThemes(canisterData.themes);
        if (canisterData.stakeholder_type === '...') canisterData.stakeholder_type = '';
        if (canisterData.geography === '...') canisterData.geography = '';
        if (canisterData.context === '...') canisterData.context = '';
        if (canisterData.themes && canisterData.themes[0] === '...') canisterData.themes = [];
        if (canisterData.intent && canisterData.intent[0] === '...') canisterData.intent = [];
        if (canisterData.offering && canisterData.offering[0] === '...') canisterData.offering = [];
      }
    } catch(extractErr) {
      console.error('Extraction error:', extractErr);
    }

    // legacy block kept for structure
    if (false) {
      try {
        canisterData = JSON.parse('');`;

if (nev.includes(oldExtract)) {
  nev = nev.replace(oldExtract, newExtract);
  fs.writeFileSync('routes/nev.js', nev);
  console.log('Done — extraction call added.');
} else {
  console.log('ERROR: Could not find target string. Check routes/nev.js manually.');
}

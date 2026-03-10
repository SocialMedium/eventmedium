with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    content = f.read()

# Fix 1: Change truncation logic - find last '?' and keep only that sentence
old_truncate = """    // Hard truncate: one short statement + one question max
    var qIdx = reply.indexOf('?');
    if (qIdx !== -1) { reply = reply.slice(0, qIdx + 1).trim(); }
    // Also cap at 2 sentences
    var nevSentences = reply.match(/[^.!?]+[.!?]+/g) || [reply];
    if (nevSentences.length > 2) { reply = nevSentences.slice(0,2).join(' ').trim(); }
    if (nevSentences.length > 2) { reply = nevSentences.slice(0,2).join(' ').trim(); }"""

new_truncate = """    // Hard truncate: keep only the single question sentence
    var nevSentences = reply.match(/[^.!?]+[.!?]+/g) || [reply];
    var questionSentence = null;
    for (var si = 0; si < nevSentences.length; si++) {
      if (nevSentences[si].indexOf('?') !== -1) { questionSentence = nevSentences[si].trim(); break; }
    }
    if (questionSentence) { reply = questionSentence; }"""

if old_truncate in content:
    content = content.replace(old_truncate, new_truncate)
    print('Truncation fix applied')
else:
    print('ERROR: truncation string not found')
    idx = content.find('Hard truncate')
    print(repr(content[idx:idx+300]))

# Fix 2: Add separate extraction call after reply is sent to user
# Find the res.json line and add extraction before it
old_resjson = """    res.json({
      reply: reply,
      canister_data: canisterData
    });"""

new_resjson = """    // If no canister from CANISTER_READY, extract separately
    if (!canisterData && anthropicMessages && anthropicMessages.length > 0) {
      try {
        var convText = anthropicMessages.map(function(m){ return m.role + ': ' + m.content; }).join('\\n') + '\\nassistant: ' + reply;
        var extResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            system: 'Extract profile data from this conversation. Respond ONLY with valid JSON, nothing else. No markdown, no explanation.\\nJSON format: {"stakeholder_type":"","themes":[],"intent":[],"offering":[],"context":"","geography":""}\\nstakeholder_type must be one of: founder/investor/researcher/corporate/advisor/operator\\nUse empty string or empty array if unknown. Never use "...".',
            messages: [{ role: 'user', content: 'Conversation:\\n' + convText.slice(0, 2000) }]
          })
        });
        var extData = await extResp.json();
        if (extData.content && extData.content[0] && extData.content[0].text) {
          var extText = extData.content[0].text.trim();
          var parsed = JSON.parse(extText);
          if (parsed.stakeholder_type || (parsed.themes && parsed.themes.length)) {
            canisterData = parsed;
            console.log('Extraction succeeded:', JSON.stringify(canisterData));
          }
        }
      } catch(extErr) {
        console.error('Extraction error:', extErr.message);
      }
    }

    res.json({
      reply: reply,
      canister_data: canisterData
    });"""

if old_resjson in content:
    content = content.replace(old_resjson, new_resjson)
    print('Extraction call fix applied')
else:
    print('ERROR: res.json string not found')

with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
    f.write(content)
print('All done')

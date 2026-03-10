with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    content = f.read()

# Fix 1: Strip ```json fences before JSON.parse in extraction
old_parse = "            canisterData = JSON.parse(extText);"
new_parse = "            var cleanJson = extText.replace(/```json/g,'').replace(/```/g,'').trim();\n            canisterData = JSON.parse(cleanJson);"

if old_parse in content:
    content = content.replace(old_parse, new_parse)
    print("Fix 1 applied: JSON fence stripping")
else:
    print("Fix 1 NOT found - checking nearby...")
    idx = content.find('JSON.parse(extText)')
    if idx > 0:
        print(repr(content[idx-50:idx+50]))

# Fix 2: Better truncation - find last sentence before first ? and keep just that sentence + ?
old_truncate = """    // Hard truncate: one short statement + one question max
    var qIdx = reply.indexOf('?');
    if (qIdx !== -1) { reply = reply.slice(0, qIdx + 1).trim(); }
    // Also cap at 2 sentences
    var nevSentences = reply.match(/[^.!?]+[.!?]+/g) || [reply];
    if (nevSentences.length > 2) { reply = nevSentences.slice(0,2).join(' ').trim(); }
    if (nevSentences.length > 2) { reply = nevSentences.slice(0,2).join(' ').trim(); }"""

# Find the questionSentence block instead
old_q = """    var questionSentence = null;"""

if old_q in content:
    # Find the full block
    start = content.find('    var questionSentence = null;')
    end = content.find('\n', content.find('if (questionSentence)', start)) + 1
    old_block = content[start:end]
    new_block = """    // Keep only the question sentence
    var qIdx = reply.indexOf('?');
    if (qIdx !== -1) {
      var beforeQ = reply.slice(0, qIdx + 1);
      var sentencesBeforeQ = beforeQ.match(/[^.!?]+[.!?]+/g) || [beforeQ];
      reply = sentencesBeforeQ[sentencesBeforeQ.length - 1].trim();
    }\n"""
    content = content.replace(old_block, new_block)
    print("Fix 2 applied: better truncation")
else:
    print("Fix 2: questionSentence block not found")
    idx = content.find('Hard truncate')
    if idx > 0:
        print(repr(content[idx:idx+300]))

with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
    f.write(content)
print('Done')

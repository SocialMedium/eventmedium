with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if '// Keep only the question sentence' in line:
        # Find end of this block (next blank-ish line after the if block)
        j = i
        while j < len(lines) and (lines[j].strip() == '' or j == i or lines[j].strip().startswith('var qIdx') or lines[j].strip().startswith('if (qIdx') or lines[j].strip().startswith('var beforeQ') or lines[j].strip().startswith('var sentencesBeforeQ') or lines[j].strip().startswith('reply = sentencesBeforeQ') or lines[j].strip() == '}'):
            j += 1
        
        new_block = [
            "    // Keep only the question sentence (strip all preamble)\n",
            "    var allSentences = reply.match(/[^.!?]+[.!?]+/g) || [reply];\n",
            "    var qSentence = null;\n",
            "    for (var si = 0; si < allSentences.length; si++) {\n",
            "      if (allSentences[si].indexOf('?') !== -1) { qSentence = allSentences[si].trim(); break; }\n",
            "    }\n",
            "    if (qSentence) { reply = qSentence; }\n",
        ]
        
        lines = lines[:i] + new_block + lines[j:]
        print(f"Replaced block at line {i+1}, ended at {j}")
        break

with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
    f.writelines(lines)
print('Done')

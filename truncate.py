with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    lines = f.readlines()

truncate = "    // Hard truncate to 2 sentences max\n    var nevSentences = reply.match(/[^.!?]+[.!?]+/g) || [reply];\n    if (nevSentences.length > 2) { reply = nevSentences.slice(0,2).join(' ').trim(); }\n"

lines.insert(139, truncate)

with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
    f.writelines(lines)
print('Done')

with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    lines = f.readlines()

# Find the filter/join line and insert after it
for i, line in enumerate(lines):
    if "}).filter(function(l){return l.trim()!='';" in line:
        insert_at = i + 1
        print(f"Inserting after line {i+1}: {line.rstrip()}")
        break

truncate = "    // Hard truncate to 2 sentences max\n    var nevSentences = reply.match(/[^.!?]+[.!?]+/g) || [reply];\n    if (nevSentences.length > 2) { reply = nevSentences.slice(0,2).join(' ').trim(); }\n"

# Remove the incorrectly placed truncation first
lines = [l for l in lines if 'Hard truncate to 2 sentences' not in l and 'nevSentences' not in l]

# Re-find the insert point
for i, line in enumerate(lines):
    if "}).filter(function(l){return l.trim()!='';" in line:
        insert_at = i + 1
        break

lines.insert(insert_at, truncate)

with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
    f.writelines(lines)
print('Done')

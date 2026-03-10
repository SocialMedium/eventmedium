with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    lines = f.readlines()

for i, line in enumerate(lines):
    if 'Hard truncate to 2 sentences' in line:
        # Replace the 3 truncation lines with tighter logic
        new_truncate = (
            "    // Hard truncate: one short statement + one question max\n"
            "    var qIdx = reply.indexOf('?');\n"
            "    if (qIdx !== -1) { reply = reply.slice(0, qIdx + 1).trim(); }\n"
            "    // Also cap at 2 sentences\n"
            "    var nevSentences = reply.match(/[^.!?]+[.!?]+/g) || [reply];\n"
            "    if (nevSentences.length > 2) { reply = nevSentences.slice(0,2).join(' ').trim(); }\n"
        )
        # Find end of current truncation block
        j = i
        while j < len(lines) and 'nevSentences' not in lines[j]:
            j += 1
        lines = lines[:i] + [new_truncate] + lines[j+1:]
        print(f"Replaced truncation at line {i+1}")
        break

with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
    f.writelines(lines)
print('Done')

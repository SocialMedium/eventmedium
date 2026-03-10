with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    lines = f.readlines()

# Find the line with canisterMatch and the Hard truncate block
canister_match_line = None
truncate_start = None
truncate_end = None

for i, line in enumerate(lines):
    if 'Hard truncate to 2 sentences' in line:
        truncate_start = i
    if truncate_start and 'nevSentences.length > 2' in line:
        truncate_end = i
    if 'var canisterData = null' in line:
        canister_null_line = i
    if 'var canisterMatch = reply.match' in line:
        canister_match_line = i

print(f"truncate_start={truncate_start}, truncate_end={truncate_end}, canister_match_line={canister_match_line}")

# Move truncation to AFTER the canisterMatch block
# First remove the truncation lines
truncate_lines = lines[truncate_start:truncate_end+1]
lines = lines[:truncate_start] + lines[truncate_end+1:]

# Re-find the strip canister line
for i, line in enumerate(lines):
    if "reply = reply.replace(/\\[CANISTER_READY\\]" in line:
        insert_after = i + 1
        print(f"Inserting truncation after line {i+1}")
        break

lines = lines[:insert_after] + truncate_lines + lines[insert_after:]

with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
    f.writelines(lines)
print('Done')

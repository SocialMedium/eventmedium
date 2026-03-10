with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    content = f.read()

old = '- If the user says they are done, want to stop, or says anything like "that\'s enough" / "ok" / "done"'
new = '- If the user says they are done, want to stop, or says anything like "that\'s enough" / "ok" / "done" / "have to go" / "gotta go" / "bye" / "thanks" / "all good" / "got to run"'

if old in content:
    content = content.replace(old, new)
    with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
        f.write(content)
    print('Done')
else:
    print('ERROR: not found')
    idx = content.find('If the user says they are done')
    print(repr(content[idx:idx+200]))

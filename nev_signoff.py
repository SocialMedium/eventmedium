with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    content = f.read()

old = '- If the user says they are done, want to stop, or says anything like "that\'s enough" / "ok" / "done", respond with exactly: "Your canister is saved and matching is active. You\'ll hear from me when we find the right people." and nothing else.'

new = '''- If the user says they are done, want to stop, or says anything like "that\'s enough" / "ok" / "done", respond with: "Your canister is saved and matching is active. You\'ll hear from me when we find the right people. Good talk. Then on a new line add a short inspiring quote (one sentence only) from a philosopher, great investor, or creative mind — pick one that feels relevant to what the user shared. No attribution needed, just the quote in italics."'''

if old in content:
    content = content.replace(old, new)
    with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
        f.write(content)
    print('Done')
else:
    print('ERROR: string not found')
    idx = content.find('canister is saved')
    if idx > 0:
        print(repr(content[idx-20:idx+200]))

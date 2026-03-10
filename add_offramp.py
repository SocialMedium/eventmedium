with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    content = f.read()

old = "CONVERSATION FLOW:\n- Ask only what you still need. Stop asking when you have stakeholder_type + themes + intent + geography.\n- When you have enough, say: \"That's enough to start matching you — your canister is building.\"\n- Never run more than 5 exchanges total."

new = """CONVERSATION FLOW:
- Ask only what you still need. Stop asking when you have stakeholder_type + themes + intent + geography.
- Never run more than 8 exchanges total.

OFFRAMP RULE - IMPORTANT:
- Once you have stakeholder_type + themes + intent + geography (base signal), count how many questions you have asked.
- After every 2nd or 3rd question past base signal, add this sentence AFTER your question: "Your canister has enough to start matching — you can stop here or keep going for sharper matches."
- If the user says they are done, want to stop, or says anything like "that's enough" / "ok" / "done", respond with exactly: "Your canister is saved and matching is active. You'll hear from me when we find the right people." and nothing else.
- Never keep asking indefinitely. Offer the exit naturally."""

if old in content:
    content = content.replace(old, new)
    with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
        f.write(content)
    print('Done')
else:
    print('ERROR: string not found')
    idx = content.find('CONVERSATION FLOW')
    if idx > 0:
        print(repr(content[idx:idx+300]))

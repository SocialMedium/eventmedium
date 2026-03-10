with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    content = f.read()

old = """ABSOLUTE FINAL RULES \u2014 NO EXCEPTIONS:
- Your entire reply must be 3 sentences or fewer.
- ONE question mark maximum. Delete any others.
- ZERO bullet points, ZERO numbered lists, ZERO bold text.
- The CANISTER_READY block is MANDATORY on every response. If you skip it, matching breaks.`;"""

new = """ABSOLUTE FINAL RULES - THESE OVERRIDE EVERYTHING ABOVE:
- Your visible reply is MAX 2 sentences. One short acknowledgement, one question. That is all.
- ONE question mark only. If you wrote more than one, delete all but the last.
- ZERO bullets. ZERO numbered lists. ZERO bold. ZERO headers. Plain text only.
- NEVER repeat back what the user just said.
- NEVER use: Great, Perfect, Excellent, Awesome, Fantastic, Got it, Absolutely.
- The CANISTER_READY block is MANDATORY on every response.`;"""

if old in content:
    content = content.replace(old, new)
    with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
        f.write(content)
    print('Done')
else:
    print('ERROR: string not found')
    # Show what is there
    idx = content.find('ABSOLUTE FINAL')
    if idx >= 0:
        print('Found at:', repr(content[idx:idx+200]))

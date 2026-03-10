with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    content = f.read()

# Fix signoff message
old_signoff = "reply: \"Your canister is saved and matching is active. You'll hear from me when we find the right people.\\n\\nGood talk.\\n\\n*\\\"\" + picked.q + \"\\\"*\\n— \" + picked.a,"
new_signoff = "reply: \"Your canister is saved and matching is active. I will continue to monitor events and communities for strong matches for your needs.\\n\\nGood talk.\\n\\n*\\\"\" + picked.q + \"\\\"*\\n— \" + picked.a,"

if old_signoff in content:
    content = content.replace(old_signoff, new_signoff)
    print('Signoff updated')
else:
    print('ERROR: signoff not found')
    idx = content.find("You'll hear from me")
    if idx > 0:
        print(repr(content[idx-10:idx+120]))

with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
    f.write(content)
print('Done')

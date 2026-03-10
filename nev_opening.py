with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    content = f.read()

bail = " Just say 'done' whenever you're ready to stop — more context means sharper matches, but a few answers is enough to get started."

old_new = "      opening = 'Hey ' + user.name + '! I\\'m Nev, your networking concierge. I\\'m going to ask you a few questions so I can find the right people for you at events. Let\\'s start simple — what do you do, and what are you working on right now?';"
new_new = "      opening = 'Hey ' + user.name + '! I\\'m Nev, your networking concierge. A few quick questions and I\\'ll start matching you with the right people at events." + bail + " Let\\'s start — what do you do, and what are you working on right now?';"

old_anon = "      opening = 'Hey there! I\\'m Nev, your networking concierge. Tell me a bit about yourself — what do you do, and what are you working on?';"
new_anon = "      opening = 'Hey there! I\\'m Nev, your networking concierge. A few quick questions and I\\'ll start matching you with the right people at events." + bail + " Tell me a bit about yourself — what do you do, and what are you working on?';"

if old_new in content and old_anon in content:
    content = content.replace(old_new, new_new)
    content = content.replace(old_anon, new_anon)
    with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
        f.write(content)
    print('Done')
else:
    print('ERROR: strings not found')
    idx = content.find("Hey ' + user.name")
    print(repr(content[idx:idx+200]))

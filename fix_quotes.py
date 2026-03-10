with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    content = f.read()

old = """      var quotes = [
        "The best investment you can make is in yourself.",
        "The only way to do great work is to love what you do.",
        "In the middle of every difficulty lies opportunity.",
        "It's not about ideas. It's about making ideas happen.",
        "The secret of getting ahead is getting started.",
        "Networks are the new net worth.",
        "Your network is your net worth — invest in it accordingly.",
        "The most valuable thing you can give someone is your attention.",
        "Go confidently in the direction of your dreams.",
        "The future belongs to those who believe in the beauty of their ideas."
      ];
      var quote = quotes[Math.floor(Math.random() * quotes.length)];
      return res.json({
        reply: "Your canister is saved and matching is active. You'll hear from me when we find the right people.\\n\\nGood talk.\\n\\n*" + quote + "*","""

new = """      var quotes = [
        { q: "The best investment you can make is in yourself.", a: "Warren Buffett" },
        { q: "The only way to do great work is to love what you do.", a: "Steve Jobs" },
        { q: "In the middle of every difficulty lies opportunity.", a: "Albert Einstein" },
        { q: "It's not about ideas. It's about making ideas happen.", a: "Scott Belsky" },
        { q: "The secret of getting ahead is getting started.", a: "Mark Twain" },
        { q: "Move fast and learn things.", a: "Reid Hoffman" },
        { q: "Your network is your net worth — invest in it accordingly.", a: "Porter Gale" },
        { q: "The most valuable thing you can give someone is your attention.", a: "Jim Rohn" },
        { q: "Go confidently in the direction of your dreams.", a: "Henry David Thoreau" },
        { q: "Risk comes from not knowing what you're doing.", a: "Warren Buffett" },
        { q: "The people who are crazy enough to think they can change the world are the ones who do.", a: "Steve Jobs" },
        { q: "An investment in knowledge pays the best interest.", a: "Benjamin Franklin" },
        { q: "The impediment to action advances action. What stands in the way becomes the way.", a: "Marcus Aurelius" },
        { q: "We are all connected; to each other, biologically. To the earth, chemically. To the rest of the universe atomically.", a: "Neil deGrasse Tyson" }
      ];
      var picked = quotes[Math.floor(Math.random() * quotes.length)];
      return res.json({
        reply: "Your canister is saved and matching is active. You'll hear from me when we find the right people.\\n\\nGood talk.\\n\\n*\\"" + picked.q + "\\"*\\n— " + picked.a,"""

if old in content:
    content = content.replace(old, new)
    with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
        f.write(content)
    print('Done')
else:
    print('ERROR: not found')
    idx = content.find('var quotes = [')
    print(repr(content[idx:idx+100]))

with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'r') as f:
    content = f.read()

# Find the line where message is validated and insert exit detection after it
old = "    if (!message) return res.status(400).json({ error: 'Message required' });"

new = """    if (!message) return res.status(400).json({ error: 'Message required' });

    // Server-side exit detection - bypass AI entirely for clean signoff
    var exitPhrases = ['have to go', 'gotta go', 'got to go', 'bye', 'goodbye', 'i am done', "i'm done", 'finished now', 'finish now', 'that is enough', "that's enough", 'all good', 'got to run', 'gotta run', 'stop here', 'no more', 'just matches', 'i have finished', 'enough for now', 'ok thanks', 'thank you', 'thanks bye', 'need to go'];
    var msgLower = message.toLowerCase().trim();
    var isExit = exitPhrases.some(function(p) { return msgLower.indexOf(p) !== -1; });
    if (isExit) {
      var quotes = [
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
        reply: "Your canister is saved and matching is active. You'll hear from me when we find the right people.\\n\\nGood talk.\\n\\n*" + quote + "*",
        canister_data: null
      });
    }"""

if old in content:
    content = content.replace(old, new)
    with open('/Users/jonathantanner/Downloads/event-medium/routes/nev.js', 'w') as f:
        f.write(content)
    print('Done')
else:
    print('ERROR: not found')

var Anthropic = require('@anthropic-ai/sdk');

var client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Call Claude with automatic retry on 529 overloaded errors.
 * Exponential backoff: 1s → 2s → 4s → 8s, then throws.
 *
 * Drop-in replacement for client.messages.create()
 *
 * @param {object} params  — same params as client.messages.create()
 * @param {number} retries — max attempts (default 4)
 */
async function callClaude(params, retries) {
  if (retries === undefined) retries = 4;
  for (var attempt = 0; attempt < retries; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      var status = (err && err.status) || (err && err.error && err.error.status);
      var isOverloaded =
        status === 529 ||
        (err && err.error && err.error.error && err.error.error.type === 'overloaded_error') ||
        (err && err.message && err.message.indexOf('overloaded') !== -1);

      if (isOverloaded && attempt < retries - 1) {
        var delay = Math.pow(2, attempt) * 1000;
        console.warn(
          '[anthropic] Overloaded — retrying in ' + delay + 'ms ' +
          '(attempt ' + (attempt + 1) + ' of ' + retries + ')'
        );
        await new Promise(function(r) { setTimeout(r, delay); });
        continue;
      }

      throw err;
    }
  }
}

module.exports = { callClaude: callClaude, client: client };

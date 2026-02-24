// Run: node install_dashboard.js
// Copies route + HTML, patches server.js

var fs = require('fs');

// Check we're in the right directory
if (!fs.existsSync('server.js')) {
  console.error('❌ Run this from the event-medium project root');
  process.exit(1);
}

// 1. Copy route file
console.log('Copying routes/dashboard.js...');
// The file should already be in routes/ — if running from script output, 
// the user will have placed it there. Just verify.
if (!fs.existsSync('routes/dashboard.js')) {
  console.error('❌ routes/dashboard.js not found. Copy it from the output first.');
  process.exit(1);
}

// 2. Copy HTML file
if (!fs.existsSync('public/admin-dashboard.html')) {
  console.error('❌ public/admin-dashboard.html not found. Copy it from the output first.');
  process.exit(1);
}

// 3. Register route in server.js
var server = fs.readFileSync('server.js', 'utf8');
if (server.indexOf('/api/admin') === -1) {
  // Find the last app.use route line and add after it
  var lines = server.split('\n');
  var lastRouteIdx = -1;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].match(/app\.use\('\/api\//)) lastRouteIdx = i;
  }
  if (lastRouteIdx === -1) {
    console.error('❌ Could not find route registration lines in server.js');
    process.exit(1);
  }
  lines.splice(lastRouteIdx + 1, 0,
    '',
    "app.use('/api/admin', require('./routes/dashboard').router);"
  );
  fs.writeFileSync('server.js', lines.join('\n'));
  console.log('✓ Registered /api/admin route in server.js');
} else {
  console.log('⊘ /api/admin route already registered');
}

console.log('\n✅ Dashboard installed.');
console.log('Test: node -c server.js && node -c routes/dashboard.js');
console.log('Then: git add . && git commit -m "Internal dashboard: real DB queries + vanilla HTML" && git push');
console.log('\nAccess at: https://www.eventmedium.ai/admin-dashboard.html');

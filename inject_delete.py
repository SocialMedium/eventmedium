with open('/Users/jonathantanner/Downloads/event-medium/public/communities.html', 'r') as f:
    content = f.read()

fn = """
async function deleteCommunity(id, btn) {
  var token = localStorage.getItem('auth_token');
  if (!window.confirm('Delete this community? This cannot be undone.')) return;
  try {
    var resp = await fetch('/api/communities/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
    var data = await resp.json();
    if (data.success) { btn.closest('.comm-card').remove(); }
    else { alert('Error: ' + (data.error || 'Could not delete')); }
  } catch(e) { alert('Delete failed'); }
}
"""

content = content.replace('</script>', fn + '</script>', 1)

with open('/Users/jonathantanner/Downloads/event-medium/public/communities.html', 'w') as f:
    f.write(content)
print('Done')

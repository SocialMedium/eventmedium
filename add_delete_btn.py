with open('/Users/jonathantanner/Downloads/event-medium/public/communities.html', 'r') as f:
    content = f.read()

old = """      return '<div class="comm-card" onclick="window.location.href=\\'/community.html?slug=' + c.slug + '\\'">' +
        badge +
        '<div class="comm-name">' + esc(c.name) + '</div>' +"""

new = """      var deleteBtn = c.role === 'owner'
        ? '<button class="delete-comm-btn" onclick="event.stopPropagation();deleteCommunity(' + c.id + ',this)" title="Delete">&#x2715;</button>'
        : '';
      return '<div class="comm-card" style="position:relative" onclick="window.location.href=\\'/community.html?slug=' + c.slug + '\\'">' +
        deleteBtn +
        badge +
        '<div class="comm-name">' + esc(c.name) + '</div>' +"""

if old in content:
    content = content.replace(old, new)
    print('Card updated')
else:
    print('ERROR: not found')

# Add deleteCommunity function and CSS
old_css = '.comm-card:hover{border-color:var(--p);box-shadow:var(--shadowL);transform:translateY(-2px)}'
new_css = '''.comm-card:hover{border-color:var(--p);box-shadow:var(--shadowL);transform:translateY(-2px)}
.delete-comm-btn{position:absolute;top:10px;right:10px;background:none;border:none;color:#ccc;font-size:16px;cursor:pointer;padding:2px 6px;border-radius:6px;line-height:1}
.delete-comm-btn:hover{background:#fee2e2;color:#ef4444}'''

content = content.replace(old_css, new_css)

# Add deleteCommunity JS function before </script>
delete_fn = """
    async function deleteCommunity(id, btn) {
      if (!confirm('Delete this community? This cannot be undone.')) return;
      try {
        var resp = await fetch('/api/communities/' + id, {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        var data = await resp.json();
        if (data.success) {
          btn.closest('.comm-card').remove();
        } else {
          alert('Error: ' + (data.error || 'Could not delete'));
        }
      } catch(e) {
        alert('Delete failed');
      }
    }
"""

content = content.replace('    async function loadCommunities()', delete_fn + '    async function loadCommunities()')

with open('/Users/jonathantanner/Downloads/event-medium/public/communities.html', 'w') as f:
    f.write(content)
print('Done')

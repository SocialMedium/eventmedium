with open('/Users/jonathantanner/Downloads/event-medium/routes/communities.js', 'r') as f:
    content = f.read()

delete_route = """
// -- DELETE /api/communities/:id -- delete community (owner only)
router.delete('/:id', authenticateToken, async function(req, res) {
  try {
    var community = await dbGet('SELECT * FROM communities WHERE id = $1', [req.params.id]);
    if (!community) return res.status(404).json({ error: 'Not found' });
    if (community.owner_user_id !== req.user.id) return res.status(403).json({ error: 'Not owner' });
    await dbRun('DELETE FROM community_members WHERE community_id = $1', [req.params.id]);
    await dbRun('DELETE FROM communities WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch(err) {
    console.error('Delete community error:', err);
    res.status(500).json({ error: 'Failed to delete' });
  }
});
"""

content = content + delete_route
with open('/Users/jonathantanner/Downloads/event-medium/routes/communities.js', 'w') as f:
    f.write(content)
print('Done')

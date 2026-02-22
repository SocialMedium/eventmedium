// ══════════════════════════════════════════════════════
// INBOX.HTML PATCH — Add debrief button to contact actions
// ══════════════════════════════════════════════════════
//
// In inbox.html, find the contact-actions div in mutualCardHTML()
// and ADD the debrief button:
//
// BEFORE:
//   <div class="contact-actions">
//     ${p.email ? `<a class="contact-btn btn-email" ...>` : ''}
//     <button class="contact-btn btn-message" onclick="toggleMessage(${m.match_id})">...</button>
//   </div>
//
// AFTER:
//   <div class="contact-actions">
//     ${p.email ? `<a class="contact-btn btn-email" ...>` : ''}
//     <button class="contact-btn btn-message" onclick="toggleMessage(${m.match_id})"><i data-lucide="message-circle"></i> Message</button>
//     <a class="contact-btn btn-message" href="/debrief.html?match=${m.match_id}" style="background:var(--sL);color:var(--s);border-color:var(--s)"><i data-lucide="sparkles"></i> Debrief</a>
//   </div>
//
// Also add to the feedback bar — after the feedback buttons, add:
//     <a href="/debrief.html?match=${m.match_id}" style="margin-left:auto;font-size:12px;color:var(--s);text-decoration:none;font-weight:500">Chat with Nev →</a>
//
// If feedback already exists, show it:
//     ${m.feedback && m.feedback.nev_chat_completed ? '<span style="color:var(--okD);font-size:12px">✓ Debriefed</span>' : ''}

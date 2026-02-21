/**
 * Calendar Modal — Event Medium
 * The commit moment: calendar + share + Nev prompt in one flow.
 * Include this on any page that needs the post-commit modal.
 */

(function() {
  'use strict';

  // ── Inject modal HTML + styles on load ──
  function injectModal() {
    // Styles
    var style = document.createElement('style');
    style.textContent = `
      .cm-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.45);z-index:250;display:none;align-items:center;justify-content:center;padding:24px;animation:cmFadeIn 0.2s ease}
      .cm-overlay.active{display:flex}
      @keyframes cmFadeIn{from{opacity:0}to{opacity:1}}
      .cm-modal{background:#ffffff;border-radius:20px;padding:0;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.15);animation:cmSlideUp 0.3s ease}
      @keyframes cmSlideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
      .cm-header{padding:28px 28px 0;text-align:center}
      .cm-check{width:52px;height:52px;border-radius:50%;background:#e6faf2;display:flex;align-items:center;justify-content:center;margin:0 auto 14px}
      .cm-check svg{width:26px;height:26px;color:#059669}
      .cm-header h2{font-size:20px;font-weight:700;margin-bottom:4px;color:#1a1d29}
      .cm-header p{font-size:14px;color:#6b7280}
      .cm-section{padding:20px 28px;border-top:1px solid #e5e7eb}
      .cm-section:first-of-type{border-top:none}
      .cm-section-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#9ca3af;margin-bottom:12px}
      .cm-cal-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .cm-cal-btn{display:flex;align-items:center;gap:8px;padding:10px 14px;background:#f8f9fd;border:1px solid #e5e7eb;border-radius:10px;font-size:13px;font-weight:500;color:#1a1d29;cursor:pointer;text-decoration:none;transition:all 0.2s;font-family:inherit}
      .cm-cal-btn:hover{border-color:#0066ff;color:#0066ff;background:#e8f0fe}
      .cm-cal-btn svg,.cm-cal-btn i{width:16px;height:16px;flex-shrink:0}
      .cm-share-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px}
      .cm-share-btn{display:flex;align-items:center;justify-content:center;gap:6px;padding:10px 12px;background:#f8f9fd;border:1px solid #e5e7eb;border-radius:10px;font-size:12px;font-weight:600;color:#6b7280;cursor:pointer;text-decoration:none;transition:all 0.2s;font-family:inherit}
      .cm-share-btn:hover{border-color:#0066ff;color:#0066ff;background:#e8f0fe}
      .cm-share-btn svg,.cm-share-btn i{width:14px;height:14px}
      .cm-nev{display:flex;align-items:center;gap:14px;padding:16px;background:linear-gradient(135deg,#0a1628,#1a2744);border-radius:12px;color:white}
      .cm-nev-avatar{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#0066ff,#6c63ff);display:flex;align-items:center;justify-content:center;flex-shrink:0}
      .cm-nev-avatar svg{width:20px;height:20px;color:white}
      .cm-nev-text{flex:1}
      .cm-nev-text strong{font-size:14px;display:block;margin-bottom:2px}
      .cm-nev-text span{font-size:12px;color:rgba(255,255,255,0.65)}
      .cm-nev-go{padding:8px 16px;background:white;color:#1a1d29;font-size:12px;font-weight:600;border-radius:8px;text-decoration:none;white-space:nowrap;transition:all 0.2s;flex-shrink:0}
      .cm-nev-go:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,0.2)}
      .cm-footer{padding:16px 28px 24px;text-align:center}
      .cm-close{padding:10px 24px;background:#f8f9fd;color:#6b7280;border:1px solid #e5e7eb;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all 0.2s}
      .cm-close:hover{background:#e5e7eb;color:#1a1d29}
      .cm-toast-inline{font-size:12px;color:#059669;font-weight:500;margin-top:6px;opacity:0;transition:opacity 0.2s}
      .cm-toast-inline.show{opacity:1}
      @media(max-width:480px){
        .cm-modal{max-width:100%;border-radius:16px}
        .cm-cal-grid{grid-template-columns:1fr}
        .cm-share-grid{grid-template-columns:1fr 1fr}
        .cm-nev{flex-direction:column;text-align:center;gap:10px}
      }
    `;
    document.head.appendChild(style);

    // Modal container
    var overlay = document.createElement('div');
    overlay.className = 'cm-overlay';
    overlay.id = 'calendarModal';
    overlay.addEventListener('click', function(e) { if (e.target === overlay) window.CalendarModal.close(); });
    document.body.appendChild(overlay);
  }

  // ── Build .ics file content ──
  function buildICS(ev) {
    var appUrl = window.location.origin;
    var date = ev.event_date ? new Date(ev.event_date) : new Date();
    var endDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    var location = [ev.venue, ev.city, ev.country].filter(Boolean).join(', ');

    var description = [
      'Your Event Hub: ' + appUrl + '/event.html?id=' + ev.id,
      '',
      'Find your matches: ' + appUrl + '/canister.html?event_id=' + ev.id,
      '',
      'Tell Nev what you\'re looking for: ' + appUrl + '/onboard.html?event_id=' + ev.id,
      '',
      'Know someone who should be there?',
      appUrl + '/event.html?id=' + ev.id,
      '',
      'Event Medium finds the right conversations before you arrive.'
    ].join('\\n');

    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Event Medium//eventmedium.ai//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'DTSTART:' + fmtICSDate(date),
      'DTEND:' + fmtICSDate(endDate),
      'SUMMARY:' + icsEscape(ev.name + ' · Event Medium'),
      'LOCATION:' + icsEscape(location),
      'DESCRIPTION:' + description,
      'URL:' + appUrl + '/event.html?id=' + ev.id,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    return lines.join('\r\n');
  }

  function fmtICSDate(d) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  function icsEscape(s) {
    if (!s) return '';
    return s.replace(/[,;\\]/g, function(c) { return '\\' + c; });
  }

  // ── Build Google Calendar URL ──
  function buildGCalUrl(ev) {
    var appUrl = window.location.origin;
    var date = ev.event_date ? new Date(ev.event_date) : new Date();
    var endDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    var location = [ev.venue, ev.city, ev.country].filter(Boolean).join(', ');

    var description = ev.name + '\n\n' +
      'Your Event Hub: ' + appUrl + '/event.html?id=' + ev.id + '\n\n' +
      'Find your matches before you go:\n' + appUrl + '/canister.html?event_id=' + ev.id + '\n\n' +
      'Tell Nev what you\'re looking for:\n' + appUrl + '/onboard.html?event_id=' + ev.id + '\n\n' +
      'Know someone who should be there?\n' + appUrl + '/event.html?id=' + ev.id;

    return 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(ev.name + ' · Event Medium') +
      '&dates=' + fmtICSDate(date) + '/' + fmtICSDate(endDate) +
      '&details=' + encodeURIComponent(description) +
      (location ? '&location=' + encodeURIComponent(location) : '');
  }

  // ── Build Outlook URL ──
  function buildOutlookUrl(ev) {
    var date = ev.event_date ? new Date(ev.event_date) : new Date();
    var endDate = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    var location = [ev.venue, ev.city, ev.country].filter(Boolean).join(', ');
    var appUrl = window.location.origin;

    var description = ev.name + '\n\n' +
      'Your Event Hub: ' + appUrl + '/event.html?id=' + ev.id + '\n\n' +
      'Find your matches: ' + appUrl + '/canister.html?event_id=' + ev.id;

    return 'https://outlook.live.com/calendar/0/action/compose?' +
      'subject=' + encodeURIComponent(ev.name + ' · Event Medium') +
      '&startdt=' + date.toISOString() +
      '&enddt=' + endDate.toISOString() +
      (location ? '&location=' + encodeURIComponent(location) : '') +
      '&body=' + encodeURIComponent(description);
  }

  // ── Download .ics file ──
  function downloadICS(ev) {
    var content = buildICS(ev);
    var blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = (ev.name || 'event').replace(/[^a-zA-Z0-9]/g, '_') + '.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── Share helpers ──
  function getShareText(ev) {
    return 'Going to ' + ev.name + '. Using an AI to curate the right conversations — if you\'re attending, see if we match.';
  }

  function getShareUrl(ev) {
    return window.location.origin + '/event.html?id=' + ev.id;
  }

  function shareNative(ev) {
    if (navigator.share) {
      navigator.share({ title: ev.name, text: getShareText(ev), url: getShareUrl(ev) });
      return true;
    }
    return false;
  }

  function copyShareLink(ev) {
    var text = getShareText(ev) + '\n' + getShareUrl(ev);
    navigator.clipboard.writeText(text).then(function() {
      var toast = document.getElementById('cmCopyToast');
      if (toast) { toast.className = 'cm-toast-inline show'; setTimeout(function() { toast.className = 'cm-toast-inline'; }, 2000); }
    });
  }

  // ── Render and open modal ──
  function open(ev) {
    var overlay = document.getElementById('calendarModal');
    if (!overlay) return;

    var appUrl = window.location.origin;
    var shareUrl = getShareUrl(ev);
    var shareText = getShareText(ev);

    var twitterUrl = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(shareText) + '&url=' + encodeURIComponent(shareUrl);
    var linkedInUrl = 'https://www.linkedin.com/sharing/share-offsite/?url=' + encodeURIComponent(shareUrl);
    var whatsappUrl = 'https://wa.me/?text=' + encodeURIComponent(shareText + '\n' + shareUrl);
    var emailUrl = 'mailto:?subject=' + encodeURIComponent(ev.name + ' — Event Medium') + '&body=' + encodeURIComponent(shareText + '\n\n' + shareUrl);

    var html = '<div class="cm-modal">' +
      '<div class="cm-header">' +
        '<div class="cm-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>' +
        '<h2>You\'re going!</h2>' +
        '<p>' + esc(ev.name) + '</p>' +
      '</div>' +

      '<div class="cm-section">' +
        '<div class="cm-section-label">Add to calendar</div>' +
        '<div class="cm-cal-grid">' +
          '<a href="' + buildGCalUrl(ev) + '" target="_blank" class="cm-cal-btn" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> Google Calendar</a>' +
          '<a href="' + buildOutlookUrl(ev) + '" target="_blank" class="cm-cal-btn" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> Outlook</a>' +
          '<a href="#" class="cm-cal-btn" onclick="event.preventDefault();event.stopPropagation();CalendarModal.downloadICS()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> Download .ics</a>' +
          '<a href="#" class="cm-cal-btn" onclick="event.preventDefault();event.stopPropagation();CalendarModal.downloadICS()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg> Apple Calendar</a>' +
        '</div>' +
      '</div>' +

      '<div class="cm-section">' +
        '<div class="cm-section-label">Share with someone who should be there</div>' +
        '<div class="cm-share-grid">' +
          '<a href="#" class="cm-share-btn" onclick="event.preventDefault();CalendarModal.copyLink()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg> Copy link</a>' +
          '<a href="' + twitterUrl + '" target="_blank" class="cm-share-btn" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> X</a>' +
          '<a href="' + linkedInUrl + '" target="_blank" class="cm-share-btn" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg> LinkedIn</a>' +
          '<a href="' + whatsappUrl + '" target="_blank" class="cm-share-btn" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> WhatsApp</a>' +
          '<a href="' + emailUrl + '" class="cm-share-btn" onclick="event.stopPropagation()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg> Email</a>' +
        '</div>' +
        '<div class="cm-toast-inline" id="cmCopyToast">Copied to clipboard!</div>' +
      '</div>' +

      '<div class="cm-section">' +
        '<div class="cm-nev">' +
          '<div class="cm-nev-avatar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg></div>' +
          '<div class="cm-nev-text"><strong>Tell Nev what you\'re looking for</strong><span>Get matched with the right people before you arrive</span></div>' +
          '<a href="' + appUrl + '/onboard.html?event_id=' + ev.id + '" class="cm-nev-go">Talk to Nev</a>' +
        '</div>' +
      '</div>' +

      '<div class="cm-footer">' +
        '<button class="cm-close" onclick="CalendarModal.close()">Done</button>' +
      '</div>' +
    '</div>';

    overlay.innerHTML = html;
    overlay.classList.add('active');

    // Store current event for download/copy actions
    window._cmCurrentEvent = ev;
  }

  function close() {
    var overlay = document.getElementById('calendarModal');
    if (overlay) overlay.classList.remove('active');
  }

  function esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Init ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectModal);
  } else {
    injectModal();
  }

  // ── Public API ──
  window.CalendarModal = {
    open: open,
    close: close,
    downloadICS: function() {
      if (window._cmCurrentEvent) downloadICS(window._cmCurrentEvent);
    },
    copyLink: function() {
      if (window._cmCurrentEvent) copyShareLink(window._cmCurrentEvent);
    },
    getShareText: getShareText,
    getShareUrl: getShareUrl,
    buildGCalUrl: buildGCalUrl
  };
})();

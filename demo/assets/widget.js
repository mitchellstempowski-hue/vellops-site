/* =====================================================================
   Vellops website chat widget — widget.js (client-installable edition)
   One script tag install. No external dependencies.

     <script src="https://vellops.com/chat/widget.js"
             data-client="acme-plumbing"
             data-endpoint="https://vellops.com/chat/chat-api.php" defer></script>

   Or configure in JS before the tag:
     window.VELLOPS_CHAT = { client: 'vellops', endpoint: './chat-api.php' };

   Speaks the PRODUCTION chat-api.php contract (see chat-api.php.server):
     POST {action:'start'|'message'|'lead_submit', session_id, text, client}
     ->   {ok, session_id, reply, cta?, ctas?, handoff?, show_lead_form?}
   The session id is issued by the server ('ws_…') and kept in
   localStorage so a returning visitor continues the same conversation.

   Mock mode (cfg.mock = true + cfg.knowledge = <knowledge object>)
   answers locally with a mirror of the endpoint's branch order —
   identity first, then handoff, booking, knowledge — for offline QA
   and Demo Drop previews. See test.html.

   Demo Drop edition additions (2026-10-27, demo/assets copy only):
   - demo_chips: 3 scripted "ask this" suggestion chips rendered from
     knowledge.demo_chips (per-demo pricing / booking / hours questions),
     kept visible for the whole demo session.
   - Owner-alert preview: when a demo visitor's email is captured, an
     on-screen mock of the email alert the owner would receive is shown
     in the chat (clearly labelled demo preview — no email is sent).
   - Event tracking: view / start / completion beacons to
     demo-track.php -> vellops-data/demo-events.jsonl (slug + event +
     per-load random sid only; no visitor PII).
   ===================================================================== */
(function () {
  'use strict';
  if (window.__vellopsChatLoaded) return;
  window.__vellopsChatLoaded = true;

  var script = document.currentScript;
  var cfg = Object.assign({}, window.VELLOPS_CHAT || {});
  if (script) {
    ['client', 'endpoint', 'title', 'accent', 'position'].forEach(function (k) {
      var v = script.getAttribute('data-' + k);
      if (v && !cfg[k]) cfg[k] = v;
    });
    if (script.getAttribute('data-mock') === 'true') cfg.mock = true;
  }
  cfg.client = cfg.client || 'vellops';
  cfg.endpoint = cfg.endpoint || 'chat-api.php';
  cfg.position = cfg.position || 'right';
  var accent = cfg.accent || '#0e7c7b';

  if (cfg.css !== false && script && script.src) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = script.src.replace(/widget\.js(\?.*)?$/, 'widget.css');
    document.head.appendChild(link);
  }

  var LS_KEY = 'vellops_chat_' + cfg.client;
  var store = {};
  try { store = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { store = {}; }
  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {} }

  // ---------------- DOM ----------------
  var root = document.createElement('div');
  root.className = 'vlp-root vlp-' + cfg.position;
  root.innerHTML =
    '<button class="vlp-bubble" aria-label="Chat with us" aria-expanded="false">' +
    '  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 3C6.5 3 2 6.9 2 11.7c0 2.7 1.5 5.1 3.8 6.6-.1 1-.5 2.3-1.3 3.2 0 0 2.9-.3 4.9-1.7.8.2 1.7.3 2.6.3 5.5 0 10-3.9 10-8.7S17.5 3 12 3z"/></svg>' +
    '  <span class="vlp-bubble-dot" hidden></span>' +
    '</button>' +
    '<section class="vlp-panel" hidden role="dialog" aria-label="Chat">' +
    '  <header class="vlp-head">' +
    '    <div><div class="vlp-title">Chat with us</div><div class="vlp-sub">Typically replies instantly</div></div>' +
    '    <button class="vlp-close" aria-label="Close chat">✕</button>' +
    '  </header>' +
    '  <div class="vlp-msgs" role="log" aria-live="polite"></div>' +
    '  <div class="vlp-chips"></div>' +
    '  <form class="vlp-lead" hidden>' +
    '    <div class="vlp-lead-title">Great — just a few details:</div>' +
    '    <input name="name" type="text" placeholder="Your name" autocomplete="name" maxlength="120" required>' +
    '    <input name="contact" type="text" placeholder="Your email" autocomplete="email" maxlength="120" required>' +
    '    <textarea name="need" placeholder="What do you need help with?" rows="2" maxlength="500" required></textarea>' +
    '    <button type="submit" class="vlp-lead-send">Send &amp; we\'ll follow up</button>' +
    '    <button type="button" class="vlp-lead-skip">Never mind, just chatting</button>' +
    '  </form>' +
    '  <form class="vlp-inputbar">' +
    '    <input class="vlp-input" type="text" placeholder="Type your message…" maxlength="1000" aria-label="Type your message">' +
    '    <button class="vlp-send" type="submit" aria-label="Send">➤</button>' +
    '  </form>' +
    '  <div class="vlp-foot">Powered by <strong>Vellops</strong><span class="vlp-mock-badge" hidden> · local demo mode</span></div>' +
    '</section>';
  document.body.appendChild(root);
  root.style.setProperty('--vlp-accent', accent);

  var bubble = root.querySelector('.vlp-bubble');
  var panel = root.querySelector('.vlp-panel');
  var msgs = root.querySelector('.vlp-msgs');
  var chips = root.querySelector('.vlp-chips');
  var input = root.querySelector('.vlp-input');
  var inputBar = root.querySelector('.vlp-inputbar');
  var leadForm = root.querySelector('.vlp-lead');
  var titleEl = root.querySelector('.vlp-title');
  var open = false, greeted = false;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function renderText(s) {
    return esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
  }
  function addMsg(text, who) {
    var d = document.createElement('div');
    d.className = 'vlp-msg vlp-' + who;
    d.innerHTML = renderText(text);
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    return d;
  }
  function addCtas(ctas) {
    if (!ctas || !ctas.length) return;
    var wrap = document.createElement('div');
    wrap.className = 'vlp-ctas';
    ctas.forEach(function (c) {
      if (!c || !/^https?:\/\//.test(c.url || '')) return;
      var a = document.createElement('a');
      a.className = 'vlp-cta'; a.href = c.url; a.textContent = c.label || 'Continue →';
      a.target = '_blank'; a.rel = 'noopener';
      wrap.appendChild(a);
    });
    msgs.appendChild(wrap);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function typing(on) {
    var t = msgs.querySelector('.vlp-typing');
    if (on && !t) {
      t = document.createElement('div');
      t.className = 'vlp-msg vlp-bot vlp-typing';
      t.innerHTML = '<span></span><span></span><span></span>';
      msgs.appendChild(t);
      msgs.scrollTop = msgs.scrollHeight;
    } else if (!on && t) t.remove();
  }
  function setChips(list) {
    chips.innerHTML = '';
    (list || []).forEach(function (label) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'vlp-chip'; b.textContent = label;
      b.addEventListener('click', function () { sendUser(label); });
      chips.appendChild(b);
    });
  }
  function showLeadForm(show) {
    leadForm.hidden = !show;
    if (show) { var f = leadForm.querySelector('input'); if (f) f.focus(); }
  }

  // ---------------- transport (production contract) ----------------
  function post(payload) {
    if (cfg.mock) return Promise.resolve(mockReply(payload));
    return fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ client: cfg.client, session_id: store.session || '' }, payload))
    }).then(function (r) { return r.json(); });
  }
  function adoptSession(res) {
    if (res && res.session_id && res.session_id !== store.session) { store.session = res.session_id; save(); }
  }
  function handleResponse(res) {
    typing(false);
    adoptSession(res);
    if (res && res.reply) addMsg(res.reply, 'bot');
    if (res && (res.ctas || res.cta)) addCtas(res.ctas || [res.cta]);
    if (res && res.show_lead_form) showLeadForm(true);
    if (res && (res.lead_captured || res.handoff)) {
      track('completion');
      showOwnerAlert({ name: '', email: lastVisitorEmail });
    }
  }
  function sendUser(text) {
    text = (text || '').trim();
    if (!text) return;
    track('start');
    var em = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
    if (em) lastVisitorEmail = em[0];
    addMsg(text, 'user');
    input.value = '';
    setChips([]);
    typing(true);
    post({ action: 'message', text: text })
      .then(function (res) {
        handleResponse(res);
        if (cfg.mock) setDemoChips();
      })
      .catch(function () {
        typing(false);
        addMsg("Sorry about that — I hit a little hiccup. Could you try that once more?", 'bot');
      });
  }

  // ---------------- demo mechanics: tracking, chips, owner alert ----
  // Demo Drop previews only (cfg.mock). All three are no-ops in
  // production mode so this file stays safe if reused elsewhere.
  var trackSid = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  var trackFired = {};
  var lastVisitorEmail = '';
  var alertShown = false;
  var lastDemoChips = null;
  function trackUrl() {
    // GitHub Pages migration (2026-11-25): the tracker lives on the API host —
    // demo-track.php is NOT a sibling of this file on Pages, so the URL is absolute.
    return 'https://api.vellops.com/demo/assets/demo-track.php';
  }
  function track(event) {
    if (!cfg.mock || trackFired[event]) return;
    trackFired[event] = true;
    try {
      var body = JSON.stringify({ demo: cfg.client, event: event, sid: trackSid });
      // Fetch first: a cross-origin sendBeacon with a JSON-typed Blob does not
      // survive (no working preflight path) — the 2026-11-25 post-migration QA
      // browser logged zero events while fetch-based calls worked. Fetch with
      // keepalive performs the CORS preflight correctly against the API host.
      if (window.fetch) {
        window.fetch(trackUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      } else if (navigator.sendBeacon) {
        navigator.sendBeacon(trackUrl(), new Blob([body], { type: 'application/json' }));
      }
    } catch (e) {}
  }
  track('view');

  // 3 scripted "ask this" chips from THIS demo's knowledge.demo_chips
  // (per-demo pricing / booking / hours questions). Returns false when the
  // demo carries no demo_chips, so callers can fall back to quick_replies.
  function setDemoChips(list) {
    if (list && list.length) lastDemoChips = list;
    var use = lastDemoChips || cfg.chips || (cfg.knowledge && cfg.knowledge.demo_chips);
    if (!cfg.mock || !use || !use.length) return false;
    chips.innerHTML = '';
    var hint = document.createElement('span');
    hint.className = 'vlp-chips-hint';
    hint.textContent = 'Try asking — tap one:';
    chips.appendChild(hint);
    use.slice(0, 3).forEach(function (label) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'vlp-chip'; b.textContent = label;
      b.addEventListener('click', function () { sendUser(label); });
      chips.appendChild(b);
    });
    return true;
  }

  // The AHA moment: a mock of the email alert the owner would receive the
  // moment a lead lands. Clearly a demo preview — no email is sent.
  function showOwnerAlert(lead) {
    if (!cfg.mock || alertShown) return;
    alertShown = true;
    var k = cfg.knowledge || {};
    var biz = k.business_name || 'the business';
    var to = (k.contact && k.contact.email) || 'the owner';
    var name = (lead && lead.name) || 'A website visitor';
    var email = (lead && (lead.email || lead.contact)) || '';
    var need = (lead && lead.need) || '';
    var d = document.createElement('div');
    d.className = 'vlp-owner-alert';
    d.innerHTML =
      '<div class="vlp-oa-tag">Demo preview — the alert ' + esc(biz) + ' would get</div>' +
      '<div class="vlp-oa-mail">' +
      '<div class="vlp-oa-row"><span>To:</span> ' + esc(to) + '</div>' +
      '<div class="vlp-oa-row"><span>Subject:</span> New booking from your website chat — ' + esc(biz) + '</div>' +
      '<div class="vlp-oa-body">Your website chatbot just captured a new lead:<br>' +
      '<strong>Name:</strong> ' + esc(name) + '<br>' +
      (email ? '<strong>Email:</strong> ' + esc(email) + '<br>' : '') +
      (need ? '<strong>Needs:</strong> ' + esc(need) + '<br>' : '') +
      'The full chat conversation comes with it, so you can follow up right away.</div>' +
      '<div class="vlp-oa-note">Demo only — no email was actually sent.</div>' +
      '</div>';
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
  }

  // ---------------- mock engine (mirrors chat-api.php) -----------------
  var mockState = { awaitingNumber: false };
  function mockIdentity(text, biz) {
    var b = biz.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('\\b(are|r) (you|u)\\b.{0,40}\\b(human|robot|ai|a\\.i\\.|bot|real)\\b|\\bwho are you\\b|\\bis this\\b.{0,25}\\b(a )?(real )?(human|person|robot|ai|bot)\\b|\\bwho\\b.{0,25}\\b(runs?|owns?|operates?|started|founded|created)\\b.{0,20}\\b' + b + '\\b|\\bwho\\b.{0,15}\\b' + b + '\\b.{0,20}\\b(run|operated)\\b|\\bwho.s behind\\b.{0,30}\\b' + b + '\\b', 'i');
    return re.test(text);
  }
  function mockExtract(text) {
    var f = {};
    var e = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/); if (e) f.email = e[0];
    var p = text.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/); if (p) f.phone = p[0];
    return f;
  }
  function mockReply(payload) {
    var k = cfg.knowledge || {};
    var biz = k.business_name || 'this business';
    if (payload.action === 'start') {
      return { ok: true, session_id: store.session || ('ws_mock' + Math.random().toString(36).slice(2, 8)),
               reply: k.greeting || 'Hi there! Happy to help — what can I do for you?',
               config: { business_name: biz, accent_color: k.accent_color, quick_replies: k.quick_replies || [], demo_chips: k.demo_chips || [] } };
    }
    if (payload.action === 'lead_submit') {
      var lead = payload.lead || {};
      var hasContact = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.contact || '');
      if (!lead.name || !hasContact || !lead.need) {
        return { ok: false, reply: 'Almost there — I just need your name, your email, and a quick note about what you need.' };
      }
      var confirm = (k.lead_confirm || 'Thank you so much, {name}! 🎉 We\'ve got your info — we\'ll follow up by email very soon. Anything else I can help with?').replace('{name}', lead.name.split(' ')[0]);
      return { ok: true, lead_captured: true, reply: confirm + ' (Demo mode: this lead was not saved anywhere.)' };
    }
    var msg = payload.text || '';
    var t = ' ' + msg.toLowerCase() + ' ';
    var contact = mockExtract(msg);
    var has = function (list) { return list.some(function (n) { return t.indexOf(n) !== -1; }); };

    // 1) Identity — FIRST, never a handoff (mirrors chat-api.php).
    if (mockIdentity(msg, biz.toLowerCase())) {
      return { ok: true, reply: k.identity_reply || ("I'm the AI assistant for " + biz + " — I'm an AI, not a person, and I'm happy to help!") };
    }
    // 2) Handoff awaiting-number state.
    if (mockState.awaitingNumber && contact.email) {
      mockState.awaitingNumber = false;
      return { ok: true, handoff: true, reply: k.handoff_confirm || "Thank you so much! I've passed this to the owner with your email — they'll email you shortly." };
    }
    if (mockState.awaitingNumber && has(['never mind', 'no thanks', 'skip', 'forget it', 'not right now'])) {
      mockState.awaitingNumber = false; // fall through to normal answering
    } else if (has(['talk to a person', 'real person', 'call me', 'speak with', 'human'])) {
      if ((k.handoff_mode || 'owner_text') === 'in_chat') {
        return { ok: true, reply: k.person_request_reply || "I run things end to end here — there's no person to hand you to. Ask me anything and I'll take care of it right here." };
      }
      if (contact.email) return { ok: true, handoff: true, reply: k.handoff_confirm || "Thank you so much! I've passed this to the owner with your email — they'll email you shortly." };
      mockState.awaitingNumber = true;
      return { ok: true, reply: k.handoff_ask || "Of course — happy to pass this to the owner! What's the best email address for them to reach you at?" };
    }
    // 3) Discount begging (even mixed with buying words) → exact pricing first.
    if (has(['discount', 'cheaper', '% off'])) {
      if (k.pricing && k.pricing.summary) return { ok: true, reply: k.pricing.summary + ' Happy to walk you through it — would you like a free quick demo first?' };
    }
    // FAQ scorer (shared): best-matching FAQ answer for a message, or null.
    function faqAnswer(msg) {
      var words = msg.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      var best = null, bestScore = 0;
      (k.faqs || []).forEach(function (f) {
        var hay = ((f.q || '') + ' ' + (f.keywords || []).join(' ')).toLowerCase();
        var score = 0;
        words.forEach(function (w) { if (w.length > 2 && hay.indexOf(w) !== -1) score++; });
        (f.keywords || []).forEach(function (kw) { if (msg.toLowerCase().indexOf(kw.toLowerCase()) !== -1) score += 2; });
        if (score > bestScore) { bestScore = score; best = f.a; }
      });
      return best ? { a: best, score: bestScore } : null;
    }
    // 4) Booking / buying intent.
    if (has(['book', 'appointment', 'schedule', 'get started', 'sign up', 'sign me up', 'free inspection', 'free estimate', 'free consultation', 'instant measurement'])) {
      // Informational free-X questions ("Do you offer free estimates?",
      // "Can I get a free estimate?") with a direct FAQ answer get the
      // answer first — it carries the contact route anyway. Explicit
      // booking verbs ("book a free estimate") still go to booking.
      if (has(['free estimate', 'free inspection', 'free consultation']) && !has(['book', 'schedule', 'appointment'])) {
        var fa = faqAnswer(msg);
        if (fa && fa.score >= 4) return { ok: true, reply: fa.a };
      }
      if (k.booking && k.booking.link) return { ok: true, reply: (k.booking.instructions || 'You can book right here:') + ' ' + k.booking.link, ctas: [{ label: 'Book now →', url: k.booking.link }] };
      return { ok: true, show_lead_form: true, reply: k.lead_prompt || "I'd love to help with that! Could I grab your name, the best email to reach you, and a quick note about what you need?" };
    }
    // 4) Knowledge answers.
    if (has(['price', 'pricing', 'cost', 'how much', 'fee', 'charge', 'discount', 'cheaper', 'expensive', 'too much', 'per month', 'monthly', '$'])) {
      if (k.pricing && k.pricing.summary) return { ok: true, reply: k.pricing.summary + ' Happy to walk you through it — would you like a free quick demo first?' };
    }
    if (has(['hours', 'open', 'what time'])) return { ok: true, reply: k.hours || k.fallback || 'Happy to help!' };
    if (has(['where', 'located', 'location', 'address'])) return { ok: true, reply: k.location ? "We're in " + k.location + '.' : (k.fallback || 'Happy to help!') };
    if (has(['services', 'what do you do', 'offer'])) {
      return { ok: true, reply: 'Here\'s what we can help with:\n' + (k.services || []).map(function (s) { return '• ' + (s.name || s) + (s.description ? ' — ' + s.description : ''); }).join('\n') };
    }
    if (has(['demo', 'see it work', 'try it'])) {
      return { ok: true, show_lead_form: true, reply: ((k.setup && k.setup.demo_offer) || 'We offer a free quick demo so you can see it work before you decide.') + ' Just share your name and the best way to reach you and we\'ll set it up!' };
    }
    if (/^\s*(hi|hey|hello)\b/i.test(msg)) return { ok: true, reply: 'Hello! Great to meet you. I can help with questions about ' + biz + ', pricing, or getting started — what are you looking for?' };
    var fb = faqAnswer(msg);
    if (fb && fb.score >= 2) return { ok: true, reply: fb.a };
    return { ok: true, show_lead_form: true, reply: k.fallback || 'Thanks for reaching out! Leave your name and the best way to reach you and we\'ll follow up by email.' };
  }

  // ---------------- events ----------------
  function setOpen(v) {
    open = v;
    panel.hidden = !v;
    bubble.setAttribute('aria-expanded', String(v));
    root.querySelector('.vlp-bubble-dot').hidden = true;
    if (v && !greeted) {
      greeted = true;
      typing(true);
      post({ action: 'start' }).then(function (res) {
        typing(false);
        adoptSession(res);
        var c = (res && res.config) || {};
        if (c.business_name) titleEl.textContent = c.business_name;
        if (c.accent_color && !cfg.accent) root.style.setProperty('--vlp-accent', c.accent_color);
        if (res && res.reply) addMsg(res.reply, 'bot');
        if (!setDemoChips(c.demo_chips)) setChips(cfg.chips || c.quick_replies || (cfg.knowledge && cfg.knowledge.quick_replies) || ['What does it cost?', 'Can I see a demo?', 'Book / get started']);
      }).catch(function () {
        typing(false);
        addMsg('Hi there! Happy to help — what can I do for you?', 'bot');
      });
      input.focus();
    }
  }
  bubble.addEventListener('click', function () { setOpen(!open); });
  root.querySelector('.vlp-close').addEventListener('click', function () { setOpen(false); });
  inputBar.addEventListener('submit', function (e) { e.preventDefault(); sendUser(input.value); });
  leadForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var fd = new FormData(leadForm);
    var lead = {
      name: String(fd.get('name') || '').trim(),
      contact: String(fd.get('contact') || '').trim(),
      need: String(fd.get('need') || '').trim()
    };
    typing(true);
    post({ action: 'lead_submit', lead: lead }).then(function (res) {
      typing(false);
      adoptSession(res);
      if (res && res.ok) { showLeadForm(false); leadForm.reset(); }
      if (res && res.reply) addMsg(res.reply, 'bot');
      if (res && res.ok) { track('completion'); showOwnerAlert(lead); }
    }).catch(function () {
      typing(false);
      addMsg("Hmm, that didn't go through — could you try once more?", 'bot');
    });
  });
  leadForm.querySelector('.vlp-lead-skip').addEventListener('click', function () { showLeadForm(false); input.focus(); });
  if (cfg.mock) root.querySelector('.vlp-mock-badge').hidden = false;

  // Public handle (production widget exposes window.vellopsChat similarly).
  window.VellopsChat = {
    open: function () { setOpen(true); },
    close: function () { setOpen(false); },
    say: function (t) { if (!open) setOpen(true); sendUser(t); }
  };
})();

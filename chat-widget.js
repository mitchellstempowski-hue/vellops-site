/* Vellops live chat widget — first-party, no external services. */
(function () {
  'use strict';
  var API = 'https://api.vellops.com/chat-api.php';
  var sid = null;
  try { sid = sessionStorage.getItem('vellops_chat_sid'); } catch (e) {}

  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html !== undefined) d.innerHTML = html;
    return d;
  }

  var bubble = el('button', 'vchat-bubble', '<span class="vchat-dot"></span><span class="vchat-bubble-label">Chat with Vella</span>');
  bubble.setAttribute('aria-label', 'Open live chat');
  var teaser = el('div', 'vchat-teaser vchat-hidden', 'Questions? Vella can walk you through it.');
  var panel = el('div', 'vchat-panel vchat-hidden');
  panel.innerHTML =
    '<div class="vchat-header"><div class="vchat-id"><div class="vchat-avatar" aria-hidden="true">V</div><div><div class="vchat-title">Vella</div>' +
    '<div class="vchat-sub">Vellops\' AI assistant · replies instantly</div></div></div>' +
    '<button class="vchat-close" aria-label="Close chat">×</button></div>' +
    '<div class="vchat-msgs"></div>' +
    '<div class="vchat-quick">' +
    '<button data-q="How does the Vellops chatbot work?">How it works</button>' +
    '<button data-q="How much does it cost?">Pricing</button>' +
    '<button data-q="I\'m ready to get started">Get started →</button>' +
    '<button data-q="__demo__">🎬 Try the interactive walkthrough</button>' +
    '</div>' +
    '<div class="vchat-inputrow"><input class="vchat-input" type="text" placeholder="Type your message…" maxlength="1000" aria-label="Chat message">' +
    '<button class="vchat-send" aria-label="Send">➤</button></div>';

  document.body.appendChild(teaser);
  document.body.appendChild(bubble);
  document.body.appendChild(panel);

  var msgs = panel.querySelector('.vchat-msgs');
  var input = panel.querySelector('.vchat-input');

  function scrollDown() { msgs.scrollTop = msgs.scrollHeight; }
  function addMsg(who, text) {
    var m = el('div', 'vchat-msg vchat-' + who, '');
    m.textContent = text;
    msgs.appendChild(m);
    scrollDown();
  }
  // Checkout CTA: a real tappable button inside the chat window.
  function addCTA(label, url) {
    var wrap = el('div', 'vchat-msg vchat-ai vchat-ctawrap', '');
    var a = el('a', 'vchat-cta', '');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = label || 'Continue to checkout →';
    wrap.appendChild(a);
    msgs.appendChild(wrap);
    scrollDown();
  }
  function visitorRef() {
    var r = '';
    try { r = (localStorage.getItem('vellops_ref') || '').toUpperCase(); } catch (e) {}
    return /^[A-Z0-9]{2,8}-[A-Z0-9]{4}$/.test(r) ? r : '';
  }
  function typing(on) {
    var t = panel.querySelector('.vchat-typing');
    if (on && !t) {
      t = el('div', 'vchat-msg vchat-ai vchat-typing', '···');
      msgs.appendChild(t); scrollDown();
    } else if (!on && t) { t.remove(); }
  }

  function api(body) {
    return fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  var started = false;
  var startPromise = null;
  function ensureStart() {
    if (startPromise) return startPromise;
    startPromise = api({ action: 'start', session_id: sid }).then(function (d) {
      started = true;
      if (d.session_id) { sid = d.session_id; try { sessionStorage.setItem('vellops_chat_sid', sid); } catch (e) {} }
      if (d.reply) addMsg('ai', d.reply);
    }).catch(function () {
      started = true;
      addMsg('ai', "Hey! I'm Vella, the Vellops assistant. Ask me about the AI chatbot we build for your website, pricing, or how it'd work for your business.");
    });
    return startPromise;
  }

  function send(text, isHandoff) {
    text = (text || '').trim();
    if (!text) return;
    addMsg('you', text);
    input.value = '';
    typing(true);
    ensureStart().then(function () {
      var body = { action: isHandoff ? 'handoff' : 'message', session_id: sid, text: text };
      var ref = visitorRef();
      if (ref) body.ref = ref;
      return api(body);
    }).then(function (d) {
      typing(false);
      addMsg('ai', d.reply || "Hmm, something glitched on my end — mind trying that again?");
      if (d.ctas && d.ctas.length) {
        for (var i = 0; i < d.ctas.length; i++) {
          if (d.ctas[i] && d.ctas[i].url) addCTA(d.ctas[i].label, d.ctas[i].url);
        }
      } else if (d.cta && d.cta.url) addCTA(d.cta.label, d.cta.url);
    }).catch(function () {
      typing(false);
      addMsg('ai', "I'm having trouble reaching my brain at the moment — you can always text (586) 203-9434 and our AI will take care of you.");
    });
  }

  function open() {
    panel.classList.remove('vchat-hidden');
    bubble.classList.add('vchat-hidden');
    teaser.classList.add('vchat-hidden');
    ensureStart();
    setTimeout(function () { input.focus(); }, 150);
  }
  function close() {
    panel.classList.add('vchat-hidden');
    bubble.classList.remove('vchat-hidden');
  }

  bubble.addEventListener('click', open);
  teaser.addEventListener('click', open);
  panel.querySelector('.vchat-close').addEventListener('click', close);
  panel.querySelector('.vchat-send').addEventListener('click', function () { send(input.value, false); });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter') send(input.value, false); });
  panel.querySelectorAll('.vchat-quick button').forEach(function (b) {
    b.addEventListener('click', function () {
      var q = b.getAttribute('data-q');
      if (q === '__demo__') send('Show me the interactive walkthrough', false);
      else send(q, false);
    });
  });

  // Public hook so page content (e.g. the "Try the interactive walkthrough" button in the
  // demo section) can open the chat and start the walkthrough in one tap.
  try {
    window.vellopsChat = {
      open: open,
      demo: function () { open(); send('Show me the interactive walkthrough', false); }
    };
  } catch (e) {}

  // One proactive nudge per session after ~30s (research sweet spot 30-45s),
  // only if never opened.
  var nudged = false;
  try { nudged = !!sessionStorage.getItem('vellops_chat_nudged'); } catch (e) {}
  if (!nudged) {
    setTimeout(function () {
      if (panel.classList.contains('vchat-hidden')) {
        teaser.classList.remove('vchat-hidden');
        try { sessionStorage.setItem('vellops_chat_nudged', '1'); } catch (e) {}
        setTimeout(function () { teaser.classList.add('vchat-hidden'); }, 12000);
      }
    }, 30000);
  }
})();

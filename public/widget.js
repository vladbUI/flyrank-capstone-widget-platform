/* Embeddable lead-capture widget. Loaded via: <script async src="<api>/widget.js?id=<widget-id>&v=<version>"></script> */
(function () {
  'use strict';
  var script = document.currentScript;
  if (!script) return;
  var src = new URL(script.src);
  var api = src.origin;
  var id = src.searchParams.get('id');
  if (!id) return console.warn('[widget] missing ?id=');

  fetch(api + '/v1/widgets/' + encodeURIComponent(id) + '/config')
    .then(function (r) { if (!r.ok) throw new Error('config HTTP ' + r.status); return r.json(); })
    .then(render)
    .catch(function (e) { console.warn('[widget]', e.message); });

  function el(tag, props, children) {
    var n = document.createElement(tag);
    for (var k in props) n[k] = props[k];
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function newKey() {
    return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  // Owners pick any accent colour: choose dark or white button text by WCAG relative luminance.
  function textOn(hex) {
    var n = parseInt(hex.slice(1), 16);
    var c = [n >> 16, (n >> 8) & 255, n & 255].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.179 ? '#18181b' : '#fff';
  }

  function render(cfg) {
    var host = el('div');
    var root = host.attachShadow({ mode: 'open' }); // host page CSS can't leak in, ours can't leak out
    var accent = cfg.display.accentColor;
    var floating = cfg.display.position === 'floating';
    root.appendChild(el('style', { textContent:
      ':host{all:initial;--a:' + accent + ';--on:' + textOn(accent) + ';font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#18181b}' +
      '.w{background:#fff;' +
        'border:1px solid #e4e4e7;border-radius:12px;padding:20px;width:100%;max-width:360px;box-sizing:border-box}' +
      (floating ? '.w{position:fixed;right:16px;bottom:76px;z-index:2147483647;max-width:min(360px,calc(100vw - 32px));' +
        'max-height:calc(100vh - 92px);overflow:auto;border:0;box-shadow:0 12px 32px -8px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.08)}' +
        '.launch{position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:12px 20px;border-radius:999px;' +
        'box-shadow:0 8px 20px -6px rgba(0,0,0,.35)}[hidden]{display:none!important}' : '') +
      'h3{margin:0;font-size:17px;font-weight:700;letter-spacing:-.01em}p{margin:4px 0 0;color:#52525b}' +
      'form{display:grid;gap:12px;margin-top:16px}' +
      'label{display:grid;gap:4px;font-size:13px;font-weight:500}.req{color:#71717a;font-weight:400}' +
      'input,textarea{width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid #d4d4d8;border-radius:8px;background:#fff;' +
        'color:inherit;font:inherit;font-size:14px;font-weight:400;transition:border-color .15s,box-shadow .15s}' +
      'textarea{min-height:88px;resize:vertical}' +
      'input:hover,textarea:hover{border-color:#a1a1aa}' +
      'input:focus,textarea:focus{outline:0;border-color:var(--a);box-shadow:0 0 0 3px color-mix(in srgb,var(--a) 25%,transparent)}' +
      'button{justify-self:start;padding:9px 16px;border:0;border-radius:8px;background:var(--a);color:var(--on);font:inherit;font-weight:600;cursor:pointer;transition:filter .15s}' +
      'button:hover{filter:brightness(.92)}button:active{filter:brightness(.84)}' +
      'button:focus-visible{outline:2px solid var(--a);outline-offset:2px}button:disabled{opacity:.6;cursor:progress}' +
      '.msg{font-size:13px;color:#3f3f46}.msg:empty{display:none}.msg.err{color:#b42318}' +
      '::selection{background:color-mix(in srgb,var(--a) 25%,transparent)}' +
      '.hp{position:absolute;left:-9999px}'
    }));

    // All text goes in via textContent: owner-supplied config can't inject HTML into the host page.
    var form = el('form');
    cfg.fields.forEach(function (f) {
      var input = el(f.type === 'textarea' ? 'textarea' : 'input', {
        name: f.name, required: f.required, maxLength: f.maxLength,
      });
      if (f.type !== 'textarea') input.type = f.type;
      var req = f.required ? el('span', { className: 'req', textContent: ' *' }) : null;
      if (req) req.setAttribute('aria-hidden', 'true'); // `required` already announces it
      var text = el('span', { textContent: f.label }, [req]);
      form.appendChild(el('label', {}, [text, input]));
    });
    // Honeypot: off-screen, not tabbable, no autocomplete. Humans leave it empty, naive bots fill it.
    var hp = el('input', { name: 'website', tabIndex: -1, autocomplete: 'off' });
    form.appendChild(el('label', { className: 'hp', textContent: 'Website' }, [hp]));
    hp.parentNode.setAttribute('aria-hidden', 'true');

    var button = el('button', { type: 'submit', textContent: cfg.buttonText });
    var msg = el('div', { className: 'msg', role: 'status' });
    form.appendChild(button);
    form.appendChild(msg);
    function setMsg(text, isError) { msg.textContent = text; msg.className = isError ? 'msg err' : 'msg'; }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fields = {};
      cfg.fields.forEach(function (f) { var v = form.elements[f.name].value.trim(); if (v) fields[f.name] = v; });
      button.disabled = true;
      setMsg('Sending…');
      send({ fields: fields, hp: hp.value }, newKey(), 1).then(function (r) {
        if (r.ok) { form.reset(); setMsg('Thanks! We got it.'); }
        else if (r.status === 429) setMsg('Too many attempts. Wait a few seconds and try again.', true);
        else setMsg('Something in the form wasn’t accepted. Check your entries and try again.', true);
      }).catch(function () { setMsg('Couldn’t reach the server. Check your connection and try again.', true); })
        .then(function () { button.disabled = false; });
    });

    // Network failures are retried once with the SAME idempotency key, so the server stores it at most once.
    function send(body, key, retries) {
      return fetch(api + '/v1/widgets/' + encodeURIComponent(cfg.id) + '/submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(body),
      }).catch(function (err) {
        if (retries > 0) return send(body, key, retries - 1);
        throw err;
      });
    }

    var children = [el('h3', { textContent: cfg.title })];
    if (cfg.description) children.push(el('p', { textContent: cfg.description }));
    children.push(form);
    var panel = el('div', { className: 'w', id: 'panel' }, children);
    root.appendChild(panel);

    if (!floating) return script.parentNode.insertBefore(host, script.nextSibling);

    // Floating: start collapsed behind a launcher so the form never covers the host page uninvited.
    var launch = el('button', { type: 'button', className: 'launch', textContent: cfg.title });
    launch.setAttribute('aria-controls', 'panel');
    function setOpen(open) {
      panel.hidden = !open;
      launch.setAttribute('aria-expanded', String(open));
      launch.textContent = open ? 'Close' : cfg.title;
      if (open) form.elements[0].focus();
    }
    launch.addEventListener('click', function () { setOpen(panel.hidden); });
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape') { setOpen(false); launch.focus(); } });
    setOpen(false);
    root.appendChild(launch);
    document.body.appendChild(host);
  }
})();

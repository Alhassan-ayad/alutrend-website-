/* Applies dashboard edits (data/content.json) to the page.
 * Loaded in <head> so it can rebuild the team + footer before the carousel initialises.
 * If the file is missing or empty the page is left exactly as written in the HTML. */
(function () {
    'use strict';

    var script = document.currentScript;
    var siteBase = new URL('../', script ? script.src : location.href); // site root

    var content = null;
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', new URL('data/content.json', siteBase).href + '?t=' + Date.now(), false); // sync: must beat carousel init
        xhr.send();
        if (xhr.status === 200) content = JSON.parse(xhr.responseText);
    } catch (e) { /* no content file - keep defaults */ }
    if (!content) return;

    var images = content.images || {};

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function safeUrl(u) {
        u = String(u || '').trim();
        return /^(https?:\/\/|mailto:|tel:|#|\/)/i.test(u) ? u : (u ? 'https://' + u : '#');
    }
    function enc(p) { return encodeURI(p); }
    function key(raw) {
        if (!raw || /^(data:|https?:|\/\/)/i.test(raw)) return null;
        var s = raw.split(/[?#]/)[0].replace(/\\/g, '/');
        try { s = decodeURIComponent(s); } catch (e) { /* keep */ }
        return s.replace(/^\.?\/+/, '');
    }

    /* ----- team ----- */
    function applyTeam() {
        var t = content.team;
        // The section is hidden in the HTML; the dashboard switch turns it on
        if (t && t.visible === true) {
            document.querySelectorAll('.team-one').forEach(function (s) { s.style.display = ''; });
        }
        if (!t || !t.members) return;
        var icons = { linkedin: 'images/resource/linkedin.svg', twitter: 'images/resource/twitter.svg', facebook: 'images/resource/facebook.svg', instagram: 'images/resource/instagram.svg' };
        document.querySelectorAll('.team-carousel').forEach(function (el) {
            el.innerHTML = t.members.map(function (m) {
                var links = Object.keys(icons).filter(function (k) { return m.socials && m.socials[k]; }).map(function (k) {
                    return '<li><a href="' + esc(safeUrl(m.socials[k])) + '" target="_blank" rel="noopener"><i class="icon"><img src="' + icons[k] + '" alt="' + k + '"></i></a></li>';
                }).join('');
                return '<div class="team-block_one"><div class="inner-box">' +
                    '<div class="content"><h3><a href="#">' + esc(m.name) + '</a></h3><div class="designation">' + esc(m.role) + '</div></div>' +
                    '<div class="image"><img src="' + esc(enc(m.image)) + '" alt="' + esc(m.name) + '"></div>' +
                    '<div class="social-links">' + (links ? '<ul class="clearfix">' + links + '</ul>' : '') + '</div>' +
                    '</div></div>';
            }).join('');
        });
        if (t.heading != null) {
            document.querySelectorAll('.team-one .sec-title h2').forEach(function (h) { h.textContent = t.heading; });
        }
    }

    /* ----- footer ----- */
    function applyFooter() {
        var f = content.footer;
        if (!f) return;
        var phoneLi = function (p) { return '<li class="phone"><a href="tel:' + esc(String(p).replace(/[^\d+]/g, '')) + '">Contact: ' + esc(p) + '</a></li>'; };
        var emailLi = function (e) { return e ? '<li class="email"><a href="mailto:' + esc(e) + '">Email: ' + esc(e) + '</a></li>' : ''; };
        var socials = (f.socials || []).map(function (s) {
            var style = /\.png$/i.test(s.icon) ? ' style="width:60px;height:60px;"' : '';
            return '<li><a href="' + esc(safeUrl(s.url)) + '" target="_blank" rel="noopener"><i class="icon"><img src="' + esc(enc(s.icon)) + '" alt="' + esc(s.label) + '" title="' + esc(s.label) + '"' + style + '></i></a></li>';
        }).join('');

        var html =
            '<div class="row clearfix">' +
              '<div class="big-col info-col col-xl-6 col-lg-6 col-md-12 col-sm-12">' +
                '<div class="row clearfix">' +
                  '<div class="footer-column col-lg-5 col-md-6 col-sm-12"><div class="footer-widget links-widget">' +
                    '<h5>' + esc(f.contactTitle) + '</h5><div class="info"><ul>' +
                      (f.phones || []).map(phoneLi).join('') + emailLi(f.email) +
                    '</ul></div></div></div>' +
                  '<div class="footer-column col-lg-7 col-md-6 col-sm-12"><div class="footer-widget links-widget">' +
                    '<h5>' + esc(f.hoursTitle) + '</h5><div class="info"><ul>' +
                      (f.hours || []).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') +
                    '</ul></div></div></div>' +
                '</div>' +
                '<div class="social-links"><ul class="clearfix">' + socials + '</ul></div>' +
              '</div>' +
              '<div class="big-col col-xl-6 col-lg-6 col-md-12 col-sm-12"><div class="row clearfix">' +
                '<div class="footer-column col-lg-6 col-md-6 col-sm-12"><div class="footer-widget links-widget">' +
                  '<h5>' + esc(f.branchTitle) + '</h5><div class="info"><ul>' +
                    (f.address ? '<li class="address">' + esc(f.address) + '</li>' : '') +
                    (f.branchPhone ? phoneLi(f.branchPhone) : '') + emailLi(f.branchEmail) +
                  '</ul></div></div></div>' +
              '</div></div>' +
            '</div>';

        document.querySelectorAll('.main-footer .upper-section .content-box').forEach(function (box) { box.innerHTML = html; });
        document.querySelectorAll('.main-footer .copyright').forEach(function (c) { c.textContent = f.copyright || ''; });
    }

    /* ----- images ----- */
    function applyImages() {
        document.querySelectorAll('img[src]').forEach(function (img) {
            var k = key(img.getAttribute('src'));
            if (k && images[k]) img.setAttribute('src', enc(images[k]));
        });
        document.querySelectorAll('[style*="url("]').forEach(function (el) {
            var s = el.getAttribute('style');
            var out = s.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (all, q, u) {
                var k = key(u);
                return k && images[k] ? 'url("' + enc(images[k]) + '")' : all;
            });
            if (out !== s) el.setAttribute('style', out);
        });
    }

    /* Backgrounds that live in the stylesheets: add override rules that mirror the original selectors */
    function applyCssImages() {
        var base = siteBase.pathname, css = [];
        function visit(rules, wrap) {
            Array.prototype.forEach.call(rules, function (r) {
                if (r.type === 3 && r.styleSheet) { try { visit(r.styleSheet.cssRules, wrap); } catch (e) { /* cross-origin */ } }
                else if (r.type === 4 && r.cssRules) { visit(r.cssRules, '@media ' + r.conditionText); }
                else if (r.type === 1 && r.style) {
                    var bg = r.style.getPropertyValue('background-image') || r.style.getPropertyValue('background');
                    var m = /url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(bg || '');
                    if (!m) return;
                    var u; try { u = new URL(m[1], location.href); } catch (e) { return; }
                    var k = key(decodeURIComponent(u.pathname).slice(base.length));
                    if (k && images[k]) {
                        var rule = r.selectorText + '{background-image:url("' + enc(images[k]) + '") !important}';
                        css.push(wrap ? wrap + '{' + rule + '}' : rule);
                    }
                }
            });
        }
        Array.prototype.forEach.call(document.styleSheets, function (sheet) {
            try { visit(sheet.cssRules, ''); } catch (e) { /* cross-origin sheet */ }
        });
        if (css.length) {
            var st = document.createElement('style');
            st.textContent = css.join('\n');
            document.head.appendChild(st);
        }
    }

    // Registered before jQuery's ready handlers, so team/footer are in place before owl-carousel starts
    document.addEventListener('DOMContentLoaded', function () {
        applyTeam();
        applyFooter();
        applyImages();
    });
    window.addEventListener('load', applyCssImages);
})();

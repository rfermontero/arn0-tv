/*
 * Next episodes of the shows you follow (watchlist + recently watched), from Trakt. Read-only and without a login: it needs a
 * Trakt app client id and a public profile (config.js `trakt`). Leave either null and the table
 * never appears.
 *
 * Refreshes every 30 seconds while the launcher is on screen, and when it comes back to the
 * foreground; the last result is cached for an instant first frame.
 */
(function () {
    'use strict';

    var API = 'https://api.trakt.tv';
    var STORE_KEY = 'arn0.shows.v3';
    // shortcut: ~2 Trakt calls per followed show each time; with 60+ shows this nears Trakt's 1000 calls/5 min, slow it then.
    var FRESH_MS = 30 * 1000;
    var RECENT_SHOWS = 30;      // one request per show, so only the most recently watched are checked
    var cfg = window.LAUNCHER_CONFIG.trakt || {};
    var lastFetch = 0;
    var shown = null;
    // Per Trakt show id: { at, item }. Next episodes change rarely, so the 30 s refresh only re-reads the
    // two lists and asks per show again after EPISODE_TTL_MS or once the cached episode has aired.
    var known = {};
    var EPISODE_TTL_MS = 6 * 60 * 60 * 1000;           // what is on screen, so an unchanged refresh does not restart the scroll
    var SCROLL_PX_PER_S = 18;

    function request(url, headers) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = 10000;
            Object.keys(headers).forEach(function (k) { xhr.setRequestHeader(k, headers[k]); });
            xhr.onload = function () {
                if (xhr.status === 204) resolve(null);
                else if (xhr.status === 200) resolve(JSON.parse(xhr.responseText));
                else reject(new Error(xhr.status + ' on ' + url.split('?')[0]));
            };
            xhr.onerror = xhr.ontimeout = function () { reject(new Error('unreachable: ' + url.split('?')[0])); };
            xhr.send();
        });
    }

    function get(path) {
        return request(API + path, { 'trakt-api-version': '2', 'trakt-api-key': cfg.clientId });
    }

    // Poster and where the show streams (TMDB's JustWatch data), in one call. Empty without a TMDB key.
    // The date language from Settings (Appearance), which config.js only defaults.
    function locale() {
        return window.Prefs ? Prefs.get().appearance.locale : window.LAUNCHER_CONFIG.locale;
    }

    // "T2 E7" in Spanish (temporada), "S2 E7" otherwise.
    function code(it) {
        return (/^es/.test(locale()) ? 'T' : 'S') + it.season + ' E' + it.number;
    }

    function tmdbUrl(path) {
        return 'https://api.themoviedb.org/3' + path + (path.indexOf('?') < 0 ? '?' : '&') +
            'api_key=' + encodeURIComponent(cfg.tmdbKey) + '&language=' + locale();
    }

    // Episode title and synopsis in the launcher's language; empty when TMDB has no translation.
    function tmdbEpisode(show, ep) {
        if (!cfg.tmdbKey || !show.ids.tmdb) return Promise.resolve({});
        return request(tmdbUrl('/tv/' + show.ids.tmdb + '/season/' + ep.season + '/episode/' + ep.number), {})
            .then(null, function () { return {}; });
    }

    function tmdb(show) {
        if (!cfg.tmdbKey || !show.ids.tmdb) return Promise.resolve({});
        return request(tmdbUrl('/tv/' + show.ids.tmdb + '?append_to_response=watch%2Fproviders'), {})
            .then(function (res) {
                var all = res['watch/providers'] && res['watch/providers'].results;
                var here = all && all[cfg.country || 'ES'];
                var names = ((here && here.flatrate) || []).map(function (p) { return p.provider_name.trim(); })
                    .filter(function (n) { return !/with ads|channel/i.test(n); });   // ad tiers and Amazon channels repeat the same service
                return {
                    name: res.name || '',
                    where: names.slice(0, 2).join(', '),
                    poster: res.poster_path ? 'https://image.tmdb.org/t/p/w154' + res.poster_path : ''
                };
            }, function () { return {}; });
    }

    // Shows followed = the watchlist plus the most recently watched, without duplicates.
    function followedShows() {
        var user = '/users/' + encodeURIComponent(cfg.username);
        return Promise.all([
            get(user + '/watchlist/shows?extended=full'),
            get(user + '/watched/shows?extended=full,noseasons')
        ]).then(function (lists) {
            var watched = lists[1].sort(function (a, b) { return a.last_watched_at < b.last_watched_at ? 1 : -1; });
            var seen = {};
            return lists[0].slice(0, RECENT_SHOWS).concat(watched.slice(0, RECENT_SHOWS)).map(function (w) { return w.show; })
                .filter(function (show) { return !seen[show.ids.trakt] && (seen[show.ids.trakt] = true); });
        });
    }

    function fetchUpcoming() {
        return followedShows().then(function (shows) {
            return Promise.all(shows.map(function (show) {
                var id = show.ids.trakt;
                var cached = known[id];
                var aired = cached && cached.item && cached.item.aired && new Date(cached.item.aired).getTime() < Date.now();
                if (cached && !aired && Date.now() - cached.at < EPISODE_TTL_MS) return cached.item;
                return get('/shows/' + id + '/next_episode?extended=full').then(function (ep) {
                    // No date yet: still listed, last, while the show is not ended or cancelled.
                    if (!(ep && ep.first_aired) && !/returning|production|planned|upcoming/.test(show.status)) {
                        known[id] = { at: Date.now(), item: null };
                        return null;
                    }
                    var dated = ep && ep.first_aired;
                    return Promise.all([tmdb(show), dated ? tmdbEpisode(show, ep) : {}]).then(function (extra) {
                        var item = { show: extra[0].name || show.title, where: extra[0].where || '', poster: extra[0].poster || '' };
                        if (dated) {
                            item.season = ep.season; item.number = ep.number; item.aired = ep.first_aired;
                            // TMDB fills untranslated titles with "Episodio 7"; the original title says more.
                            var name = /^(episodio|episode|épisode) \d+$/i.test(extra[1].name || '') ? '' : extra[1].name;
                            item.title = name || ep.title || ''; item.overview = extra[1].overview || ep.overview || '';
                        }
                        known[id] = { at: Date.now(), item: item };
                        return item;
                    });
                }).then(null, function () { return cached ? cached.item : null; });   // one failed show must not hide the others
            }));
        }).then(function (list) {
            return list.filter(Boolean).sort(function (a, b) {
                if (!a.aired || !b.aired) return a.aired ? -1 : b.aired ? 1 : 0;
                return a.aired < b.aired ? -1 : 1;
            });
        });
    }

    function when(iso) {
        return new Date(iso).toLocaleString(locale(), {
            weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
    }

    function render(items) {
        var body = document.getElementById('shows-list');
        var since = Date.now() - 12 * 60 * 60 * 1000;   // a cached episode that already aired drops off
        var rows = (items || []).filter(function (it) { return !it.aired || new Date(it.aired).getTime() > since; })
            .slice(0, cfg.limit || 30);
        var calendar = cfg.view === 'calendar';
        var key = (calendar ? 'cal' : 'list') + new Date().toDateString() + JSON.stringify(rows);   // the date moves "today"
        if (key === shown) return;
        shown = key;
        document.querySelector('.shows-viewport').classList.toggle('hidden', calendar);
        document.getElementById('shows-calendar').classList.toggle('hidden', !calendar);
        if (calendar) {
            document.getElementById('shows-section').classList.toggle('hidden', !renderCalendar(rows));
            return;
        }
        body.innerHTML = '';
        rows.forEach(function (it) {
                var row = document.createElement('tr');
                var art = document.createElement('td');
                art.className = 'poster';
                if (it.poster) {
                    var img = document.createElement('img');
                    img.src = it.poster;
                    art.appendChild(img);
                }
                row.appendChild(art);
                [it.show, it.aired ? code(it) : '', it.aired ? when(it.aired) : I18n.t('TBA'), it.where || ''].forEach(function (text, i) {
                    var cell = document.createElement('td');
                    if (!i) cell.className = 'title';
                    cell.textContent = text;
                    row.appendChild(cell);
                });
                body.appendChild(row);
            });
        document.getElementById('shows-section').classList.toggle('hidden', !body.children.length);
        scroll();
    }

    function dayKey(d) {
        return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    }

    // Four Monday-first weeks from this week; returns how many episodes fell inside them.
    function renderCalendar(rows) {
        var cal = document.getElementById('shows-calendar');
        var byDay = {};
        rows.forEach(function (it) {
            if (!it.aired) return;
            var k = dayKey(new Date(it.aired));
            (byDay[k] = byDay[k] || []).push(it);
        });
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var start = new Date(today);
        start.setDate(today.getDate() - (today.getDay() + 6) % 7);
        var loc = locale();
        var count = 0;
        cal.innerHTML = '';
        for (var w = 0; w < 7; w++) {
            var head = document.createElement('div');
            var wd = new Date(start);
            wd.setDate(start.getDate() + w);
            head.className = 'wd';
            head.textContent = wd.toLocaleDateString(loc, { weekday: 'short' });
            cal.appendChild(head);
        }
        for (var i = 0; i < 28; i++) {
            var d = new Date(start);
            d.setDate(start.getDate() + i);
            var cell = document.createElement('div');
            cell.className = 'day' + (d < today ? ' past' : '') + (d.getTime() === today.getTime() ? ' today' : '');
            var num = document.createElement('div');
            num.className = 'num';
            num.textContent = d.getDate() === 1 || i === 0 ? d.toLocaleDateString(loc, { day: 'numeric', month: 'short' }) : d.getDate();
            cell.appendChild(num);
            var eps = byDay[dayKey(d)] || [];
            cell._item = { kind: 'day', date: d, eps: eps };
            count += eps.length;
            // Up to four posters; with more, three and a "+N" so the cell never overflows.
            var shownEps = eps.length > 4 ? eps.slice(0, 3) : eps;
            shownEps.forEach(function (it) {
                var mark;
                if (it.poster) {
                    mark = document.createElement('img');
                    mark.src = it.poster;
                } else {
                    mark = document.createElement('div');
                    mark.className = 'name';
                    mark.textContent = it.show;
                }
                cell.appendChild(mark);
            });
            if (eps.length > shownEps.length) {
                var more = document.createElement('div');
                more.className = 'more';
                more.textContent = '+' + (eps.length - shownEps.length);
                cell.appendChild(more);
            }
            cal.appendChild(cell);
        }
        if (window.UI && UI.isVisible('home')) UI.refresh();   // the cells were replaced under the focus
        return count;
    }

    // Day cells as four rows for remote navigation on Home; nothing while the calendar is off.
    function rows() {
        var cal = document.getElementById('shows-calendar');
        if (cfg.view !== 'calendar' || cal.classList.contains('hidden') ||
            document.getElementById('shows-section').classList.contains('hidden')) return [];
        return UI.chunk(UI.children(cal).filter(function (c) { return c._item; }), 7);
    }

    function openDay(item) {
        if (!item.eps.length) {
            var day = item.date.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
            UI.toast(I18n.t('{0}: no episodes', day.charAt(0).toUpperCase() + day.slice(1)));
            return;
        }
        var body = document.getElementById('episode-body');
        body.innerHTML = '';
        item.eps.forEach(function (it) {
            var row = UI.el('div', 'ep');
            if (it.poster) {
                var img = document.createElement('img');
                img.src = it.poster;
                row.appendChild(img);
            }
            var text = UI.el('div', 'ep-text');
            text.appendChild(UI.el('div', 'ep-show', it.show));
            text.appendChild(UI.el('div', 'ep-meta', code(it) + (it.title ? ' · ' + it.title : '')));
            text.appendChild(UI.el('div', 'ep-meta', when(it.aired)));
            if (it.where) text.appendChild(UI.el('div', 'ep-where', it.where));
            if (it.overview) text.appendChild(UI.el('div', 'ep-overview', it.overview));
            row.appendChild(text);
            body.appendChild(row);
        });
        UI.show('episode');
    }

    function scroll() {
        var table = document.getElementById('shows-table');
        var overflow = table.offsetHeight - table.parentNode.clientHeight;
        table.classList.remove('scrolling');
        table.parentNode.classList.toggle('overflowing', overflow > 0);
        if (overflow <= 0) return;
        table.style.setProperty('--shift', -overflow + 'px');
        // The glide is 76% of each pass (12% hold at either end).
        table.style.animationDuration = Math.round(overflow / SCROLL_PX_PER_S / 0.76) + 's';
        void table.offsetWidth;   // restart the animation from the top
        table.classList.add('scrolling');
    }

    function refresh() {
        if (!cfg.clientId || !cfg.username || Date.now() - lastFetch < FRESH_MS / 2) return;   // half: the 30 s timer must never land just short
        lastFetch = Date.now();
        fetchUpcoming().then(function (items) {
            try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch (e) { /* cache only */ }
            render(items);
        }).catch(function (err) { DevLog.log('Shows: ' + DevLog.errorText(err)); });
    }

    function start() {
        if (window.UI) {
            UI.register('episode', {
                el: document.getElementById('episode'),
                overlay: true,
                hints: [['Back', 'Close']],
                rows: function () { return []; }
            });
        }
        try { render(JSON.parse(localStorage.getItem(STORE_KEY))); } catch (e) { /* no cache */ }
        refresh();
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
        setInterval(function () { if (!document.hidden) refresh(); }, FRESH_MS);
    }

    window.Shows = { start: start, render: render, rows: rows, openDay: openDay };
})();

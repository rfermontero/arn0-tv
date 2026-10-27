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
    var STORE_KEY = 'arn0.shows.v2';
    // shortcut: ~2 Trakt calls per followed show each time; with 60+ shows this nears Trakt's 1000 calls/5 min, slow it then.
    var FRESH_MS = 30 * 1000;
    var RECENT_SHOWS = 30;      // one request per show, so only the most recently watched are checked
    var cfg = window.LAUNCHER_CONFIG.trakt || {};
    var lastFetch = 0;
    var shown = null;
    var known = {};             // last good row per Trakt show id, kept when Trakt rate-limits a refresh           // what is on screen, so an unchanged refresh does not restart the scroll
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
    function tmdb(show) {
        if (!cfg.tmdbKey || !show.ids.tmdb) return Promise.resolve({});
        return request('https://api.themoviedb.org/3/tv/' + show.ids.tmdb + '?api_key=' + encodeURIComponent(cfg.tmdbKey) +
            '&append_to_response=watch%2Fproviders', {})
            .then(function (res) {
                var all = res['watch/providers'] && res['watch/providers'].results;
                var here = all && all[cfg.country || 'ES'];
                var names = ((here && here.flatrate) || []).map(function (p) { return p.provider_name.trim(); })
                    .filter(function (n) { return !/with ads|channel/i.test(n); });   // ad tiers and Amazon channels repeat the same service
                return {
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
                return get('/shows/' + id + '/next_episode?extended=full').then(function (ep) {
                    // No date yet: still listed, last, while the show is not ended or cancelled.
                    if (!(ep && ep.first_aired) && !/returning|production|planned|upcoming/.test(show.status)) return (known[id] = null);
                    return tmdb(show).then(function (extra) {
                        var item = { show: show.title, where: extra.where || '', poster: extra.poster || '' };
                        if (ep && ep.first_aired) { item.season = ep.season; item.number = ep.number; item.aired = ep.first_aired; }
                        return (known[id] = item);
                    });
                }).then(null, function () { return known[id] || null; });   // one failed show must not hide the others
            }));
        }).then(function (list) {
            return list.filter(Boolean).sort(function (a, b) {
                if (!a.aired || !b.aired) return a.aired ? -1 : b.aired ? 1 : 0;
                return a.aired < b.aired ? -1 : 1;
            });
        });
    }

    function when(iso) {
        return new Date(iso).toLocaleString(window.LAUNCHER_CONFIG.locale, {
            weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
    }

    function render(items) {
        var body = document.getElementById('shows-list');
        var since = Date.now() - 12 * 60 * 60 * 1000;   // a cached episode that already aired drops off
        var rows = (items || []).filter(function (it) { return !it.aired || new Date(it.aired).getTime() > since; })
            .slice(0, cfg.limit || 30);
        var key = JSON.stringify(rows);
        if (key === shown) return;
        shown = key;
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
                [it.show, it.aired ? 'S' + it.season + ' E' + it.number : '', it.aired ? when(it.aired) : 'TBA', it.where || ''].forEach(function (text, i) {
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
        try { render(JSON.parse(localStorage.getItem(STORE_KEY))); } catch (e) { /* no cache */ }
        refresh();
        document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
        setInterval(function () { if (!document.hidden) refresh(); }, FRESH_MS);
    }

    window.Shows = { start: start, render: render };
})();

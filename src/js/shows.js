/*
 * Next episodes of the shows you follow (watchlist + recently watched), from Trakt. Read-only and without a login: it needs a
 * Trakt app client id and a public profile (config.js `trakt`). Leave either null and the table
 * never appears.
 *
 * Like the weather, there is no polling: it refreshes on start and when the launcher comes back
 * to the foreground, at most once an hour, and the last result is cached for an instant first frame.
 */
(function () {
    'use strict';

    var API = 'https://api.trakt.tv';
    var STORE_KEY = 'arn0.shows.v1';
    var FRESH_MS = 60 * 60 * 1000;
    var RECENT_SHOWS = 30;      // one request per show, so only the most recently watched are checked
    var cfg = window.LAUNCHER_CONFIG.trakt || {};
    var lastFetch = 0;

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

    // Where the show streams (TMDB's JustWatch data), e.g. "Netflix". Empty without a TMDB key.
    function providers(show) {
        if (!cfg.tmdbKey || !show.ids.tmdb) return Promise.resolve('');
        return request('https://api.themoviedb.org/3/tv/' + show.ids.tmdb + '/watch/providers?api_key=' + encodeURIComponent(cfg.tmdbKey), {})
            .then(function (res) {
                var here = res.results && res.results[cfg.country || 'ES'];
                var names = ((here && here.flatrate) || []).map(function (p) { return p.provider_name.trim(); })
                    .filter(function (n) { return !/with ads|channel/i.test(n); });   // ad tiers and Amazon channels repeat the same service
                return names.slice(0, 2).join(', ');
            }, function () { return ''; });
    }

    // Shows followed = the watchlist plus the most recently watched, without duplicates.
    function followedShows() {
        var user = '/users/' + encodeURIComponent(cfg.username);
        return Promise.all([
            get(user + '/watchlist/shows'),
            get(user + '/watched/shows?extended=noseasons')
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
                return get('/shows/' + show.ids.trakt + '/next_episode?extended=full').then(function (ep) {
                    if (!ep || !ep.first_aired) return null;
                    return providers(show).then(function (where) {
                        return { show: show.title, season: ep.season, number: ep.number, aired: ep.first_aired, where: where };
                    });
                }).then(null, function () { return null; });   // one broken show must not hide the others
            }));
        }).then(function (list) {
            return list.filter(Boolean).sort(function (a, b) { return a.aired < b.aired ? -1 : 1; });
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
        body.innerHTML = '';
        (items || []).filter(function (it) { return new Date(it.aired).getTime() > since; })
            .slice(0, cfg.limit || 5)
            .forEach(function (it) {
                var row = document.createElement('tr');
                [it.show, 'S' + it.season + ' E' + it.number, when(it.aired), it.where || ''].forEach(function (text) {
                    var cell = document.createElement('td');
                    cell.textContent = text;
                    row.appendChild(cell);
                });
                body.appendChild(row);
            });
        document.getElementById('shows-section').classList.toggle('hidden', !body.children.length);
    }

    function refresh() {
        if (!cfg.clientId || !cfg.username || Date.now() - lastFetch < FRESH_MS) return;
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
    }

    window.Shows = { start: start, render: render };
})();

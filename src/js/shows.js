/*
 * Next episodes of the shows you watch, from Trakt. Read-only and without a login: it needs a
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

    function get(path) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', API + path, true);
            xhr.timeout = 10000;
            xhr.setRequestHeader('trakt-api-version', '2');
            xhr.setRequestHeader('trakt-api-key', cfg.clientId);
            xhr.onload = function () {
                if (xhr.status === 204) resolve(null);
                else if (xhr.status === 200) resolve(JSON.parse(xhr.responseText));
                else reject(new Error('Trakt ' + xhr.status + ' on ' + path));
            };
            xhr.onerror = xhr.ontimeout = function () { reject(new Error('Trakt unreachable')); };
            xhr.send();
        });
    }

    function fetchUpcoming() {
        var user = encodeURIComponent(cfg.username);
        return get('/users/' + user + '/watched/shows?extended=noseasons').then(function (watched) {
            watched.sort(function (a, b) { return a.last_watched_at < b.last_watched_at ? 1 : -1; });
            return Promise.all(watched.slice(0, RECENT_SHOWS).map(function (w) {
                return get('/shows/' + w.show.ids.trakt + '/next_episode?extended=full').then(function (ep) {
                    return ep && ep.first_aired ? { show: w.show.title, season: ep.season, number: ep.number, aired: ep.first_aired } : null;
                }, function () { return null; });   // one broken show must not hide the others
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
                [it.show, 'S' + it.season + ' E' + it.number, when(it.aired)].forEach(function (text) {
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

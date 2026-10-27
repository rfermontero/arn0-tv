// Self-check for src/js/shows.js against canned Trakt/TMDB replies: node scripts/check-shows.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const day = 864e5, now = Date.now();
const T = 'https://api.trakt.tv';
const routes = {
    [T + '/users/me/watchlist/shows']: [{ show: { title: 'Silo', ids: { trakt: 2, tmdb: 20 } } }],
    [T + '/users/me/watched/shows?extended=noseasons']: [
        { last_watched_at: '2026-10-01', show: { title: 'Silo', ids: { trakt: 2, tmdb: 20 } } },
        { last_watched_at: '2026-10-20', show: { title: 'MobLand', ids: { trakt: 1, tmdb: 10 } } },
        { last_watched_at: '2026-09-01', show: { title: 'Ended', ids: { trakt: 3 } } },
        { last_watched_at: '2026-09-02', show: { title: 'Broken', ids: { trakt: 4 } } }],
    [T + '/shows/1/next_episode?extended=full']: { season: 2, number: 7, first_aired: new Date(now + day).toISOString() },
    [T + '/shows/2/next_episode?extended=full']: { season: 4, number: 1, first_aired: new Date(now + 9 * day).toISOString() },
    [T + '/shows/3/next_episode?extended=full']: null,
    'https://api.themoviedb.org/3/tv/10/watch/providers?api_key=k': { results: { ES: { flatrate: [{ provider_name: 'SkyShowtime' }, { provider_name: 'Netflix Standard with Ads' }, { provider_name: 'Apple TV Amazon Channel' }] } } },
    'https://api.themoviedb.org/3/tv/20/watch/providers?api_key=k': { results: { US: {} } }
};

const calls = [];
globalThis.XMLHttpRequest = function () {
    let url;
    this.open = (m, u) => { url = u; calls.push(u); };
    this.setRequestHeader = () => {};
    this.send = () => setTimeout(() => {
        if (!(url in routes)) this.status = 500;
        else if (routes[url] === null) this.status = 204;
        else { this.status = 200; this.responseText = JSON.stringify(routes[url]); }
        this.onload();
    });
};
const rows = [];
const el = (tag) => ({ tag, children: [], textContent: '', appendChild(c) { this.children.push(c); }, classList: { toggle() {} } });
const list = el('tbody');
Object.defineProperty(list, 'innerHTML', { set() { list.children.length = 0; } });
globalThis.document = { hidden: false, getElementById: (id) => (id === 'shows-list' ? list : el('div')), createElement: el, addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = globalThis;
window.LAUNCHER_CONFIG = { locale: 'en-GB', trakt: { clientId: 'abc', username: 'me', tmdbKey: 'k', country: 'ES' } };
window.DevLog = { log: (m) => rows.push(m), errorText: String };

new Function(readFileSync(new URL('../src/js/shows.js', import.meta.url), 'utf8'))();
window.Shows.start();
await new Promise((r) => setTimeout(r, 50));

const table = list.children.map((tr) => tr.children.map((td) => td.textContent));
assert.equal(table.length, 2, 'ended and broken shows are dropped');
assert.deepEqual([table[0][0], table[0][1], table[0][3]], ['MobLand', 'S2 E7', 'SkyShowtime']);
assert.deepEqual([table[1][0], table[1][3]], ['Silo', ''], 'no ES provider = empty cell');
assert.equal(calls.filter((c) => c.includes('/shows/2/')).length, 1, 'watchlist + watched duplicate checked once');
console.log('shows.js ok', table);
process.exit(0);   // shows.js keeps a refresh timer running

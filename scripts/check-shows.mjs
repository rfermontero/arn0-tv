// Self-check for src/js/shows.js against canned Trakt/TMDB replies: node scripts/check-shows.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const day = 864e5, now = Date.now();
const T = 'https://api.trakt.tv';
const routes = {
    [T + '/users/me/watchlist/shows?extended=full']: [{ show: { title: 'Silo', ids: { trakt: 2, tmdb: 20 } } }],
    [T + '/users/me/watched/shows?extended=full,noseasons']: [
        { last_watched_at: '2026-10-01', show: { title: 'Silo', ids: { trakt: 2, tmdb: 20 } } },
        { last_watched_at: '2026-10-20', show: { title: 'MobLand', ids: { trakt: 1, tmdb: 10 } } },
        { last_watched_at: '2026-09-01', show: { title: 'Ended', status: 'ended', ids: { trakt: 3 } } },
        { last_watched_at: '2026-09-02', show: { title: 'Broken', ids: { trakt: 4 } } },
        { last_watched_at: '2026-10-23', show: { title: 'Lupin', status: 'returning series', ids: { trakt: 5 } } }],
    [T + '/shows/1/next_episode?extended=full']: { season: 2, number: 7, first_aired: new Date(now + day).toISOString() },
    [T + '/shows/2/next_episode?extended=full']: { season: 4, number: 1, first_aired: new Date(now + 9 * day).toISOString() },
    [T + '/shows/3/next_episode?extended=full']: null,
    [T + '/shows/5/next_episode?extended=full']: null,
    'https://api.themoviedb.org/3/tv/10?api_key=k&append_to_response=watch%2Fproviders': { poster_path: '/mob.jpg', 'watch/providers': { results: { ES: { flatrate: [{ provider_name: 'SkyShowtime' }, { provider_name: 'Netflix Standard with Ads' }, { provider_name: 'Apple TV Amazon Channel' }] } } } },
    'https://api.themoviedb.org/3/tv/20?api_key=k&append_to_response=watch%2Fproviders': { poster_path: null, 'watch/providers': { results: { US: {} } } }
};

const calls = [];
const listeners = {};
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
const el = (tag) => ({ tag, children: [], textContent: '', offsetHeight: 0, parentNode: { clientHeight: 0, classList: { toggle() {} } }, style: { setProperty() {} }, appendChild(c) { this.children.push(c); }, classList: { toggle() {}, add() {}, remove() {} } });
const list = el('tbody');
Object.defineProperty(list, 'innerHTML', { set() { list.children.length = 0; } });
const els = {};
globalThis.document = { hidden: false, querySelector: () => el('div'), getElementById: (id) => (id === 'shows-list' ? list : (els[id] = els[id] || el('div'))), createElement: el, addEventListener(ev, fn) { listeners[ev] = fn; } };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = globalThis;
window.LAUNCHER_CONFIG = { locale: 'en-GB', trakt: { clientId: 'abc', username: 'me', tmdbKey: 'k', country: 'ES' } };
window.DevLog = { log: (m) => rows.push(m), errorText: String };

new Function(readFileSync(new URL('../src/js/shows.js', import.meta.url), 'utf8'))();
window.Shows.start();
await new Promise((r) => setTimeout(r, 50));

const posters = list.children.map((tr) => tr.children[0].children.length ? tr.children[0].children[0].src : '');
const table = list.children.map((tr) => tr.children.slice(1).map((td) => td.textContent));
assert.deepEqual(posters, ['https://image.tmdb.org/t/p/w154/mob.jpg', '', ''], 'poster only when TMDB has one');
assert.equal(table.length, 3, 'ended and broken shows are dropped');
assert.deepEqual(table[2], ['Lupin', '', 'TBA', ''], 'returning show without a date goes last');
assert.deepEqual([table[0][0], table[0][1], table[0][3]], ['MobLand', 'S2 E7', 'SkyShowtime']);
assert.deepEqual([table[1][0], table[1][3]], ['Silo', ''], 'no ES provider = empty cell');
assert.equal(calls.filter((c) => c.includes('/shows/2/')).length, 1, 'watchlist + watched duplicate checked once');
// A later refresh where Trakt fails MobLand keeps its last good row instead of dropping it.
delete routes[T + '/shows/1/next_episode?extended=full'];
const realNow = Date.now;
Date.now = () => realNow() + 60 * 60 * 1000;
listeners.visibilitychange();
await new Promise((r) => setTimeout(r, 50));
assert.equal(list.children[0].children[1].textContent, 'MobLand', 'failed show keeps its last row');
assert.equal(calls.filter((c) => c.includes('next_episode')).length, 6, 'second refresh only retries the show that failed (5 + Broken)');
// Calendar: 7 weekday heads + 28 days; tomorrow's MobLand poster sits in tomorrow's cell.
window.LAUNCHER_CONFIG.trakt.view = 'calendar';
Date.now = realNow;
window.Shows.render([{ show: 'MobLand', poster: 'p.jpg', season: 2, number: 7, aired: new Date(realNow() + day).toISOString() },
    { show: 'NoDate', where: '' }]);
const cal = els['shows-calendar'].children;
assert.equal(cal.length, 35);
const idx = 7 + (new Date().getDay() + 6) % 7 + 1;
assert.equal(cal[idx].children.length, 2, 'number + poster in tomorrow');
assert.equal(cal[idx].children[1].src, 'p.jpg');
assert.equal(cal.filter((c) => c.children.length > 1).length, 1, 'undated show is not placed');
console.log('shows.js ok', table);
process.exit(0);   // shows.js keeps a refresh timer running

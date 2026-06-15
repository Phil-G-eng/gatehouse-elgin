// netlify/functions/get-calendar.js
//
// Returns the current booked/blocked dates for the PUBLIC calendar by fetching
// the Airbnb + Booking.com iCal feeds server-side. No CORS, no browser storage —
// every visitor on every device gets the same live answer. This is the piece that
// makes the calendar self-maintaining: it refreshes itself whenever the page loads.
//
// Uses only the fetch() built into Netlify's Node runtime — NO npm packages — so it
// deploys fine through Netlify Drop (drag-and-drop). No netlify.toml needed.
//
// SET THESE in Netlify → Site configuration → Environment variables:
//   AIRBNB_ICAL_URL   your Airbnb  "Export calendar" URL
//   BDC_ICAL_URL      your Booking.com "Export calendar" URL
//
// (Env vars are read at runtime, not baked into the site, so they won't trip
//  Netlify's secrets scanning.)

let CACHE = { at: 0, data: null };
const CACHE_MS = 15 * 60 * 1000; // 15 minutes — protects the upstream feeds

function parseIcal(text, source) {
  const out = {}; // dateStr -> source | 'blocked'
  const blocks = text.split('BEGIN:VEVENT');
  blocks.shift();
  for (const block of blocks) {
    const ds = (block.match(/DTSTART[^:\r\n]*[:\s](\d{8})/) || [])[1];
    const de = (block.match(/DTEND[^:\r\n]*[:\s](\d{8})/) || [])[1];
    const summary = ((block.match(/SUMMARY[:\s]?(.+)/) || [])[1] || '').trim();
    if (!ds || !de) continue;
    // Treat "not available"/"blocked" placeholders as blocks, real entries as bookings
    const isReal = !/(not available|airbnb \(not available\)|blocked|tentative)/i.test(summary);
    const tag = isReal ? source : 'blocked';
    const cur = new Date(ds.slice(0, 4) + '-' + ds.slice(4, 6) + '-' + ds.slice(6, 8));
    const end = new Date(de.slice(0, 4) + '-' + de.slice(4, 6) + '-' + de.slice(6, 8));
    while (cur < end) {
      out[cur.toISOString().slice(0, 10)] = tag;
      cur.setDate(cur.getDate() + 1);
    }
  }
  return out;
}

// Merge, but never let a "blocked" placeholder overwrite a real booking
function merge(into, from) {
  for (const [d, v] of Object.entries(from)) {
    if (into[d] && into[d] !== 'blocked' && v === 'blocked') continue;
    into[d] = v;
  }
}

async function fetchFeed(url, source) {
  if (!url) return {};
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', 'Accept': 'text/calendar, text/plain, */*' } });
  if (!resp.ok) throw new Error(source + ' HTTP ' + resp.status);
  return parseIcal(await resp.text(), source);
}

export async function handler() {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=300'
  };

  // Serve from in-memory cache on warm invocations
  if (CACHE.data && (Date.now() - CACHE.at) < CACHE_MS) {
    return { statusCode: 200, headers, body: JSON.stringify({ ...CACHE.data, cached: true }) };
  }

  const booked = {};
  const errors = [];
  for (const [src, url] of [['airbnb', process.env.AIRBNB_ICAL_URL], ['bdc', process.env.BDC_ICAL_URL]]) {
    try {
      merge(booked, await fetchFeed(url, src));
    } catch (e) {
      errors.push(e.message);
    }
  }

  const data = { booked, updated: new Date().toISOString(), errors };
  // Only cache a clean result, so a transient upstream blip doesn't stick for 15 min
  if (errors.length === 0) CACHE = { at: Date.now(), data };

  return { statusCode: 200, headers, body: JSON.stringify(data) };
}

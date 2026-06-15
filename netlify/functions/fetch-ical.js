// netlify/functions/fetch-ical.js
//
// Fetches an Airbnb or Booking.com iCal feed server-side and hands it back to the
// browser with an Access-Control-Allow-Origin header, so the dashboard never hits
// a CORS wall. No npm packages, no environment variables — uses the fetch() that's
// built into Netlify's Node runtime, so it won't trip secrets scanning.

export async function handler(event) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  const url = event.queryStringParameters && event.queryStringParameters.url;
  if (!url) {
    return { statusCode: 400, headers: cors, body: 'Missing url parameter' };
  }

  // Only let this function fetch the two calendar providers. Without this it would
  // be an open proxy anyone could point at any site.
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return { statusCode: 400, headers: cors, body: 'Invalid url' };
  }
  const allowed = ['airbnb.com', 'airbnb.co.uk', 'booking.com'];
  const ok = allowed.some(h => host === h || host.endsWith('.' + h));
  if (!ok) {
    return { statusCode: 403, headers: cors, body: 'Host not allowed: ' + host };
  }

  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', 'Accept': 'text/calendar, text/plain, */*' } });
    if (!resp.ok) {
      return { statusCode: 502, headers: cors, body: 'Upstream returned HTTP ' + resp.status };
    }
    const text = await resp.text();
    return {
      statusCode: 200,
      headers: { ...cors, 'Content-Type': 'text/calendar; charset=utf-8' },
      body: text
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: 'Fetch failed: ' + e.message };
  }
}

/**
 * Proxy Dropbox shared-link files through same-origin URLs.
 * Supports:
 * - mode=preview: return resized JPEG thumbnail for fast lightbox
 * - mode=original: return original file stream
 */

async function getDropboxAccessToken() {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;

  if (!refreshToken || !appKey || !appSecret) {
    throw new Error('Dropbox credentials not configured (need DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET)');
  }

  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }).toString()
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error('Failed to refresh Dropbox token: ' + errorText);
  }

  const data = await response.json();
  return data.access_token;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const link = req.query.link;
    const path = req.query.path;
    const mode = (req.query.mode || 'preview').toLowerCase();
    const size = req.query.size || 'w2048h1536';

    if (!link || !path) {
      return res.status(400).json({ error: 'Missing required query params: link, path' });
    }

    const accessToken = await getDropboxAccessToken();

    if (mode === 'preview') {
      const previewResponse = await fetch('https://content.dropboxapi.com/2/files/get_thumbnail_v2', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Dropbox-API-Arg': JSON.stringify({
            resource: {
              '.tag': 'path',
              path
            },
            format: 'jpeg',
            size
          })
        }
      });

      if (previewResponse.ok) {
        const arrayBuffer = await previewResponse.arrayBuffer();
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        return res.status(200).send(Buffer.from(arrayBuffer));
      }

      // Fall back to original mode if thumbnail API fails for this path/type.
    }

    const response = await fetch('https://content.dropboxapi.com/2/sharing/get_shared_link_file', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({
          link,
          path
        })
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(502).json({ error: 'Dropbox proxy failed', detail: errorText });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=600');
    return res.status(200).send(Buffer.from(arrayBuffer));
  } catch (error) {
    console.error('[Dropbox Proxy] Error:', error.message);
    return res.status(500).json({ error: 'Internal server error', detail: error.message });
  }
};

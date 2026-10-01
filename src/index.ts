import { Hono } from 'hono';
import { fetchPost } from './utils';
import { renderComponentEmbed } from './renderComponentEmbed';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const app = new Hono();

app.get('/', (c) => {
  return c.redirect('https://github.com/seriaati/fxptt');
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

// Component-embed gallery videos: resolve a YouTube ID to a playable mp4 via koutube
app.get('/yt/:file', async (c) => {
  const id = c.req.param('file').replace(/\.mp4$/, '');
  if (!/^[\w-]{11}$/.test(id)) {
    return c.notFound();
  }
  try {
    const resp = await fetch(`https://koutube.com/api/watch?v=${id}`, { cf: { cacheTtl: 3600 } });
    const data = await resp.json() as { playerStreamUrl?: string; error?: string | null };
    if (data.playerStreamUrl && !data.error) {
      return c.redirect(data.playerStreamUrl, 302);
    }
  } catch {
    // fall through to the thumbnail
  }
  return c.redirect(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, 302);
});

app.get('/bbs/:board_name/:post_id', async (c) => {
  const boardName = c.req.param('board_name');
  const postId = c.req.param('post_id');
  const postUrl = `https://www.ptt.cc/bbs/${boardName}/${postId}`;

  const userAgent = c.req.header('User-Agent') || '';
  if (!userAgent.includes('Discordbot')) {
    return c.redirect(postUrl);
  }

  const post = await fetchPost(postUrl);
  if (!post) {
    return c.redirect(postUrl);
  }

  // Built from the raw post fields, before anything is HTML-escaped
  const componentEmbed = renderComponentEmbed(post, postUrl, new URL(c.req.url).origin);
  const componentEmbedTag = componentEmbed
    ? `<script id="discord:component-embed" type="application/json">${componentEmbed}</script>`
    : '';

  const title = escapeHtml(post.title);
  const content = escapeHtml(post.content);
  const author = escapeHtml(post.author);

  // Generate image meta tags for each image
  const ogImageMetaTags = post.images.map(img =>
    `<meta property="og:image" content="${escapeHtml(img)}">`
  ).join('\n        ');

  const twitterImageMetaTags = post.images.map(img =>
    `<meta name="twitter:image" content="${escapeHtml(img)}">`
  ).join('\n        ');

  const html = `
    <html>
      <head>
        <meta property="og:title" content="${title}">
        <meta property="og:description" content="${content}">
        ${ogImageMetaTags}
        <meta property="og:type" content="article">
        <meta property="og:url" content="${escapeHtml(postUrl)}">
        <meta property="og:site_name" content="PTT">
        <meta property="og:article:published_time" content="${post.postedAt}">
        <meta property="og:article:author" content="${author}">

        <meta name="twitter:card" content="${post.images.length > 0 ? 'summary_large_image' : 'summary'}">
        <meta name="twitter:site" content="PTT">
        <meta name="twitter:creator" content="${author}">
        <meta name="twitter:title" content="${title}">
        <meta name="twitter:description" content="${content}">
        ${twitterImageMetaTags}
        ${componentEmbedTag}
      </head>
    </html>
    `;

  return c.html(html);
});

export default app;

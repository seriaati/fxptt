import { Hono } from 'hono';
import { fetchPost } from './utils';

const app = new Hono();

app.get('/', (c) => {
  return c.redirect('https://github.com/seriaati/fxptt');
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
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

  // Generate image meta tags for each image
  const ogImageMetaTags = post.images.map(img =>
    `<meta property="og:image" content="${img}">`
  ).join('\n        ');

  const twitterImageMetaTags = post.images.map(img =>
    `<meta name="twitter:image" content="${img}">`
  ).join('\n        ');

  const html = `
    <html>
        <meta property="og:title" content="${post.title}">
        <meta property="og:description" content="${post.content}">
        ${ogImageMetaTags}
        <meta property="og:type" content="article">
        <meta property="og:url" content="${postUrl}">
        <meta property="og:site_name" content="PTT">
        <meta property="og:article:published_time" content="${post.postedAt}">
        <meta property="og:article:author" content="${post.author}">

        <meta name="twitter:card" content="${post.images.length > 0 ? 'summary_large_image' : 'summary'}">
        <meta name="twitter:site" content="PTT">
        <meta name="twitter:creator" content="${post.author}">
        <meta name="twitter:title" content="${post.title}">
        <meta name="twitter:description" content="${post.content}">
        ${twitterImageMetaTags}
    </html>
    `;

  return c.html(html);
});

export default app;

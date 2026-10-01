import * as cheerio from 'cheerio';

export interface Post {
  author: string;
  title: string;
  postedAt: string;
  content: string;
  images: string[];
  // Extra fields for the Discord component embed
  boardName?: string;
  authorId?: string;
  authorNick?: string;
  unix?: number;
  body?: string;
  media?: string[];
  reply?: { authorId: string; authorNick: string; text: string };
  forward?: { board: string; url: string | null; authorId: string | null; authorNick: string | null };
  pushes?: Push[];
  counts?: { up: number; down: number; arrow: number };
}

export interface Push {
  tag: string;
  user: string;
  text: string;
}

export async function fetchPost(url: string): Promise<Post | null> {
  const resp = await fetch(url, {
    headers: {
      'Cookie': 'over18=1'
    }
  });
  // Deleted or missing posts return 404
  if (!resp.ok) {
    return null;
  }
  const html = await resp.text();

  const $ = cheerio.load(html);

  // Find spans with class "article-meta-value"
  const metaValues = $('.article-meta-value');

  // Author, board, title, posted_at
  const author = metaValues.eq(0).text().trim();
  const title = metaValues.eq(2).text().trim();
  const dateStr = metaValues.eq(3).text().trim();

  // The post ID carries the unix timestamp: M.<unix>.A.XXX
  const unixMatch = url.match(/\/M\.(\d+)\.A\./);
  const unix = unixMatch ? Number(unixMatch[1]) : undefined;

  // Parse posted_at in ISO 8601 format (PTT times are Taiwan time)
  const dateStrFixed = dateStr.split(/\s+/).join(' ');
  const dt = new Date(`${dateStrFixed} GMT+0800`);
  const postedAt = !isNaN(dt.getTime())
    ? dt.toISOString()
    : unix !== undefined ? new Date(unix * 1000).toISOString() : '';

  const mainContent = $('#main-content');

  const embed = extractEmbedFields($, url);

  // Remove all div and span tags
  mainContent.find('div, span').remove();

  let content = mainContent.text().trim();

  // Remove trailing "--"
  if (content.endsWith('--')) {
    content = content.slice(0, -2).trim();
  }

  // Extract image URLs from content, skipping the signature after the first "--" line
  const imageRegex = /https?:\/\/[^\s]+\.(?:jpg|png|gif|webp|jpeg)/g;
  const images: string[] = [];

  for (const match of content.split(/\n--\n/)[0].matchAll(imageRegex)) {
    images.push(match[0]);
  }

  // Remove all image URLs from content
  content = content.replace(imageRegex, '').replace(/\n{2,}/g, '\n').trim();

  return {
    author,
    title,
    postedAt,
    content: content.trim(),
    images,
    unix,
    ...embed
  };
}

const EMBED_IMAGE_REGEX = /https?:\/\/[^\s]+\.(?:jpg|png|gif|webp|jpeg)/g;

function splitUser(s: string): [string, string] {
  const m = s.match(/^(\S+)\s*(?:\((.*)\))?$/);
  return [m?.[1] ?? s, m?.[2] ?? ''];
}

// Raw (unescaped, untruncated) fields for the component embed. Must run before the
// div/span removal in fetchPost, and works on a clone so it does not affect it.
function extractEmbedFields($: cheerio.CheerioAPI, url: string): Partial<Post> {
  const main = $('#main-content').clone();

  const meta: Record<string, string> = {};
  main.children('.article-metaline, .article-metaline-right').each((_, el) => {
    meta[$(el).find('.article-meta-tag').text()] = $(el).find('.article-meta-value').text().trim();
  });
  const [authorId, authorNick] = splitUser(meta['作者'] ?? '');

  const f2 = main.children('span.f2').map((_, el) => $(el).text().trim()).get();

  const pushes: Push[] = main.find('.push').map((_, el) => ({
    tag: $(el).find('.push-tag').text().trim(),
    user: $(el).find('.push-userid').text().trim(),
    text: $(el).find('.push-content').text().replace(/^:\s?/, '').trim(),
  })).get();
  const counts = { up: 0, down: 0, arrow: 0 };
  for (const p of pushes) {
    if (p.tag === '推') counts.up++;
    else if (p.tag === '噓') counts.down++;
    else counts.arrow++;
  }

  // Quoted lines of a reply (": text"), without nested quotes or the quoted post's signature
  const quoteLines = main.children('span.f6').map((_, el) => $(el).text().replace(/\n$/, '')).get()
    .filter(l => l.startsWith(': ') && !l.startsWith(': : ') && !l.startsWith(': ※'))
    .map(l => l.slice(2));
  const quoteSig = quoteLines.findIndex(l => /^-{2,}\s*$/.test(l));
  if (quoteSig >= 0) quoteLines.length = quoteSig;

  main.find('.article-metaline, .article-metaline-right, .push, .richcontent, span.f2, span.f6').remove();
  let body = main.text();
  // Drop the signature and footer: everything from the first "--" line
  const sig = body.search(/\n--\n/);
  if (sig >= 0) body = body.slice(0, sig);

  const media = [...body.matchAll(EMBED_IMAGE_REGEX)].map(m => m[0]);
  // Drop lines that only held an image link (optionally numbered), then inline image links
  body = body.split('\n')
    .filter(l => !l.match(EMBED_IMAGE_REGEX) || !/^\s*(\d+[.)]\s*)?$/.test(l.replace(EMBED_IMAGE_REGEX, '')))
    .join('\n')
    .replace(EMBED_IMAGE_REGEX, '');

  let reply: Post['reply'];
  const quoteHeader = f2.find(l => l.startsWith('※ 引述《'));
  if (quoteHeader) {
    const [id, nick] = splitUser(quoteHeader.match(/《(.+)》/)?.[1] ?? '');
    reply = { authorId: id, authorNick: nick, text: quoteLines.join('\n').trim() };
  }

  let forward: Post['forward'];
  const forwardHeader = f2.find(l => l.startsWith('※ [本文轉錄自'));
  if (forwardHeader) {
    const srcUrl = f2.map(l => l.match(/文章網址: (\S+)/)?.[1]).find(u => u && u !== url) ?? null;
    const hdr = body.match(/作者: (\S+) \(([^)]*)\)[^\n]*\n標題: [^\n]*\n時間: [^\n]*\n/);
    if (hdr) body = body.replace(hdr[0], '');
    forward = {
      board: forwardHeader.match(/轉錄自 (\S+) 看板/)?.[1] ?? '',
      url: srcUrl,
      authorId: hdr?.[1] ?? null,
      authorNick: hdr?.[2] ?? null,
    };
  }

  return {
    boardName: meta['看板'] || url.match(/\/bbs\/([^/]+)\//)?.[1],
    authorId,
    authorNick,
    body: body.replace(/\n{3,}/g, '\n\n').trim(),
    media,
    reply,
    forward,
    pushes,
    counts,
  };
}

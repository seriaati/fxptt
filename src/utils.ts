import * as cheerio from 'cheerio';

export interface Post {
  author: string;
  title: string;
  postedAt: string;
  content: string;
  images: string[];
}

export async function fetchPost(url: string): Promise<Post> {
  const resp = await fetch(url, {
    headers: {
      'Cookie': 'over18=1'
    }
  });
  const html = await resp.text();

  const $ = cheerio.load(html);

  // Find spans with class "article-meta-value"
  const metaValues = $('.article-meta-value');

  // Author, board, title, posted_at
  const author = metaValues.eq(0).text().trim();
  const title = metaValues.eq(2).text().trim();
  const dateStr = metaValues.eq(3).text().trim();

  // Parse posted_at in ISO 8601 format
  const dateStrFixed = dateStr.split(/\s+/).join(' ');
  const dt = new Date(dateStrFixed);
  const postedAt = dt.toISOString();

  const mainContent = $('#main-content');

  // Remove all div and span tags
  mainContent.find('div, span').remove();

  let content = mainContent.text().trim();

  // Remove trailing "--"
  if (content.endsWith('--')) {
    content = content.slice(0, -2).trim();
  }

  // Extract all image URLs from content
  const imageRegex = /https?:\/\/[^\s]+\.(?:jpg|png|gif|webp|jpeg)/g;
  const images: string[] = [];

  for (const match of content.matchAll(imageRegex)) {
    images.push(match[0]);
  }

  // Remove all image URLs from content
  content = content.replace(imageRegex, '').replace(/\n{2,}/g, '\n').trim();

  return {
    author,
    title,
    postedAt,
    content: content.trim(),
    images
  };
}

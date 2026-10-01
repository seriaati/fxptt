import type { Post } from './utils';

// Discord silently falls back to the OG card above ~3000 bytes of serialized UTF-8 JSON;
// 2990 is the largest size verified to render
const MAX_BYTES = 2990;
const ACCENT_COLOR = 0x000000;
const MIN_BODY_CHARS = 120;
const YOUTUBE_ID_REGEX = /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/live\/)([\w-]{11})/;

// Progressively tighter limits for when reply context and pushes crowd out the body
const TIERS = [
  { reply: 150, pushes: 3, gallery: 10 },
  { reply: 100, pushes: 2, gallery: 10 },
  { reply: 50, pushes: 1, gallery: 4 },
  { reply: 0, pushes: 0, gallery: 1 },
];

type Limits = (typeof TIERS)[number];
type Component = Record<string, unknown>;

export function youtubeId(url: string): string | null {
  return url.match(YOUTUBE_ID_REGEX)?.[1] ?? null;
}

// Escape only what Discord would actually format, so common PTT text (C_Chat, [公告])
// stays free of backslashes, which unfurls can render literally
function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\*|`|~~|\|\||\](?=\()/g, m => m.replace(/./g, '\\$&'))
    .replace(/(^|\W)_|_(?=\W|$)/g, m => m.replace('_', '\\_'))
    .replace(/<(?=[@#:]|a:|t:|https?:)/g, '\\<')
    .replace(/^(\s*)(#|-# |[-+] |> |\d+\. )/gm, '$1\\$2');
}

// Link labels allow balanced brackets; replace unbalanced ones so the link still parses
function escLabel(s: string): string {
  let depth = 0;
  let balanced = true;
  for (const ch of s) {
    if (ch === '[') depth++;
    else if (ch === ']' && --depth < 0) balanced = false;
  }
  const label = balanced && depth === 0 ? s : s.replace(/\[/g, '［').replace(/\]/g, '］');
  return esc(label);
}

// Escape Markdown outside URLs, keeping URLs bare so Discord autolinks them
function escText(s: string): string {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(/https?:\/\/[^\s]+/g)) {
    out += esc(s.slice(last, m.index)) + m[0];
    last = m.index! + m[0].length;
  }
  return out + esc(s.slice(last));
}

function cut(s: string, n: number): string {
  const chars = Array.from(s);
  return chars.length <= n ? s : chars.slice(0, n).join('').trimEnd() + '…';
}

const blockquote = (s: string) => s.split('\n').map(l => '> ' + l).join('\n');
const fmt = (n: number) => n.toLocaleString('en-US');
const nick = (s: string | null | undefined) => (s ? ` (${esc(s)})` : '');
const separator = (divider: boolean, spacing = 2): Component => ({ type: 14, divider, spacing });

function serialize(container: Component): string {
  return JSON.stringify({ component: container }).replace(/</g, '\\u003c');
}

const byteLength = (s: string) => new TextEncoder().encode(s).length;

function build(post: Post, url: string, origin: string, lim: Limits): { container: Component; bodyChars: number } | null {
  const boardName = post.boardName!;
  const boardUrl = `https://www.ptt.cc/bbs/${boardName}/index.html`;
  const authorUrl = `https://www.ptt.cc/bbs/${boardName}/search?q=${encodeURIComponent(`author:${post.authorId}`)}`;

  const components: Component[] = [{
    type: 10,
    content: [
      `-# [${escLabel(boardName)}](${boardUrl}) · 批踢踢實業坊`,
      `### [${escLabel(post.title)}](${url})`,
      `**[${escLabel(post.authorId!)}](${authorUrl})**${nick(post.authorNick)}`,
    ].join('\n'),
  }];

  if (post.reply) {
    const quoted = post.reply.text && lim.reply ? '\n' + blockquote(escText(cut(post.reply.text, lim.reply))) : '';
    components.push({ type: 10, content: `-# ↩️ 回覆 **${esc(post.reply.authorId)}**${nick(post.reply.authorNick)} 的文章${quoted}` });
  }

  if (post.forward) {
    const source = post.forward.url ? `[${escLabel(post.forward.board)}](${post.forward.url})` : esc(post.forward.board);
    const by = post.forward.authorId ? ` · **${esc(post.forward.authorId)}**${nick(post.forward.authorNick)}` : '';
    components.push({ type: 10, content: `-# ↪️ 轉錄自 ${source} 看板${by}` });
  }

  const body = post.body ?? '';
  const bodyComponent: Component = { type: 10, content: '' };
  if (body) components.push(bodyComponent);

  const items = (post.media ?? []).slice(0, lim.gallery).map(m => {
    const id = youtubeId(m);
    return { media: { url: id ? `${origin}/yt/${id}.mp4` : m } };
  });
  if (items.length) {
    components.push(separator(false), { type: 12, items });
  }

  const pushes = (post.pushes ?? []).slice(0, lim.pushes);
  if (pushes.length) {
    const lines = pushes.map(p => `> **${esc(p.tag)}** ${esc(p.user)}: ${escText(cut(p.text, 60))}`);
    components.push(separator(true), { type: 10, content: `-# 💬 推文\n${lines.join('\n')}` });
  }

  const counts = post.counts ?? { up: 0, down: 0, arrow: 0 };
  const footer = [`👍 **${fmt(counts.up)}**`, `👎 **${fmt(counts.down)}**`, `💬 **${fmt(counts.arrow)}**`, `<t:${post.unix}:f>`];
  components.push(
    separator(true),
    { type: 10, content: footer.join(' · ') },
    separator(false, 1),
    {
      type: 1,
      components: [
        { type: 2, style: 5, label: '開啟文章', url },
        { type: 2, style: 5, label: `${boardName} 看板`, url: boardUrl },
        { type: 2, style: 5, label: '作者文章', url: authorUrl },
      ],
    },
  );

  const container: Component = { type: 17, accent_color: ACCENT_COLOR, components };
  const fits = () => byteLength(serialize(container)) <= MAX_BYTES;

  if (!body) return fits() ? { container, bodyChars: 0 } : null;

  // Binary-search the longest body that keeps the payload under the byte cap
  const setBody = (n: number) => { bodyComponent.content = escText(cut(body, n)); };
  setBody(0);
  if (!fits()) return null;
  let lo = 0;
  let hi = Array.from(body).length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    setBody(mid);
    if (fits()) lo = mid;
    else hi = mid - 1;
  }
  setBody(lo);
  return { container, bodyChars: lo };
}

// Returns the serialized `discord:component-embed` JSON (already `<`-escaped for inline use),
// or null when the post lacks the fields it needs or cannot fit the byte cap.
export function renderComponentEmbed(post: Post, url: string, origin: string): string | null {
  if (!post.boardName || !post.authorId || post.unix === undefined) return null;

  const bodyLength = Array.from(post.body ?? '').length;
  let fallback: Component | null = null;
  for (const lim of TIERS) {
    const result = build(post, url, origin, lim);
    if (!result) continue;
    if (result.bodyChars >= Math.min(MIN_BODY_CHARS, bodyLength)) return serialize(result.container);
    fallback ??= result.container;
  }
  return fallback ? serialize(fallback) : null;
}

import { NextResponse } from "next/server";

interface NewsItem {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
}

let cachedNews: { items: NewsItem[]; fetchedAt: number } | null = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function extractSource(title: string): { cleanTitle: string; source: string } {
  // Google News format: "Headline - Source"
  const lastDash = title.lastIndexOf(" - ");
  if (lastDash > 0) {
    return {
      cleanTitle: title.slice(0, lastDash).trim(),
      source: title.slice(lastDash + 3).trim(),
    };
  }
  return { cleanTitle: title, source: "Google News" };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function timeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}min atras`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h atras`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d atras`;
}

async function fetchNews(): Promise<NewsItem[]> {
  try {
    // Google News RSS for Brazilian economy
    const res = await fetch(
      "https://news.google.com/rss/search?q=economia+brasil+OR+selic+OR+ipca+OR+ibovespa&hl=pt-BR&gl=BR&ceid=BR:pt-419",
      { next: { revalidate: 1800 } },
    );
    if (!res.ok) return [];

    const xml = await res.text();

    // Simple XML parsing — extract <item> blocks
    const items: NewsItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match: RegExpExecArray | null;

    while ((match = itemRegex.exec(xml)) !== null && items.length < 8) {
      const itemXml = match[1];

      const titleMatch = itemXml.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/);
      const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/);

      if (titleMatch && linkMatch) {
        const rawTitle = decodeHtmlEntities(titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1").trim());
        const { cleanTitle, source } = extractSource(rawTitle);
        const url = linkMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, "$1").trim();
        const pubDate = pubDateMatch?.[1]?.trim() ?? "";

        items.push({
          title: cleanTitle,
          source,
          url,
          publishedAt: pubDate ? timeAgo(pubDate) : "",
        });
      }
    }

    return items;
  } catch {
    return [];
  }
}

export async function GET() {
  if (cachedNews && Date.now() - cachedNews.fetchedAt < CACHE_TTL) {
    return NextResponse.json({ news: cachedNews.items });
  }

  const items = await fetchNews();
  cachedNews = { items, fetchedAt: Date.now() };
  return NextResponse.json({ news: items });
}

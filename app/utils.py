from dataclasses import dataclass
from datetime import datetime
import re
import aiohttp
from bs4 import BeautifulSoup


@dataclass
class Post:
    author: str
    title: str
    posted_at: str
    content: str
    image: str | None = None


async def fetch_post(session: aiohttp.ClientSession, *, url: str) -> Post:
    connector = aiohttp.TCPConnector(ssl=False)
    async with session.get(url, cookies={"over18": "1"}, connector=connector) as resp:
        html = await resp.text()

    soup = BeautifulSoup(html, "lxml")

    # Find spans with class "article-meta-value"
    meta_values = soup.find_all("span", class_="article-meta-value")

    # Author, board, title, posted_at
    author = meta_values[0].text.strip()
    title = meta_values[2].text.strip()
    date_str = meta_values[3].text.strip()

    # Write posted_at in ISO 8601 format
    date_str_fixed = " ".join(date_str.split())
    dt = datetime.strptime(date_str_fixed, "%a %b %d %H:%M:%S %Y")
    posted_at = dt.isoformat()

    main_content = soup.find(id="main-content")
    for tag in main_content.find_all(["div", "span"]):
        tag.decompose()

    content = main_content.get_text().strip().removesuffix("--")

    # Extract image URL from content
    image_match = re.search(r"https?://[^\s]+\.(?:jpg|png|gif|webp|jpeg)", content)
    if image_match:
        image = image_match.group(0)
        content = content.replace(image, "").removeprefix("\n").strip()
    else:
        image = None

    return Post(
        author=author,
        title=title,
        posted_at=posted_at,
        content=content.strip(),
        image=image,
    )

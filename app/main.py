from contextlib import asynccontextmanager
from typing import AsyncGenerator
import aiohttp
import fastapi
from fastapi import responses

from app.utils import fetch_post


@asynccontextmanager
async def lifespan(app: fastapi.FastAPI) -> AsyncGenerator:
    app.state.session = aiohttp.ClientSession()

    try:
        yield
    finally:
        await app.state.session.close()


app = fastapi.FastAPI(lifespan=lifespan)


@app.get("/")
def read_root() -> responses.RedirectResponse:
    return responses.RedirectResponse("https://github.com/seriaati/fxptt")


@app.get("/bbs/{board_name}/{post_id}")
async def fix_post(
    request: fastapi.Request, board_name: str, post_id: str
) -> responses.RedirectResponse:
    post_url = f"https://www.ptt.cc/bbs/{board_name}/{post_id}"
    if "Discordbot" not in request.headers.get("User-Agent", ""):
        return fastapi.responses.RedirectResponse(post_url)

    post = await fetch_post(app.state.session, url=post_url)
    print(post)

    html = f"""
    <html>
        <meta property="og:title" content="{post.title}">
        <meta property="og:description" content="{post.content}">
        <meta property="og:image" content="{post.image if post.image else ""}">
        <meta property="og:type" content="article">
        <meta property="og:url" content="{post_url}">
        <meta property="og:site_name" content="PTT">
        <meta property="og:article:published_time" content="{post.posted_at}">
        <meta property="og:article:author" content="{post.author}">

        <meta name="twitter:card" content="{"summary_large_image" if post.image else "summary"}">
        <meta name="twitter:site" content="PTT">
        <meta name="twitter:creator" content="{post.author}">
        <meta name="twitter:title" content="{post.title}">
        <meta name="twitter:description" content="{post.content}">
        <meta name="twitter:image" content="{post.image if post.image else ""}">
    </html>
    """

    return responses.HTMLResponse(content=html)

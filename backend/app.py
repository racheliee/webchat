import os
import aiohttp
from aiohttp import web
import asyncio
from dotenv import load_dotenv
import aioredis

# Load environment variables
load_dotenv()
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")
FRONTEND_URL = "http://localhost:3000"
REDIS_URL = "redis://localhost"

routes = web.RouteTableDef()

# Redis connection (global for simplicity)
redis = None


@routes.get("/auth/github")
async def github_login(request):
    # Redirect to GitHub's OAuth authorization page
    github_auth_url = (
        f"https://github.com/login/oauth/authorize?"
        f"client_id={GITHUB_CLIENT_ID}&redirect_uri=http://localhost:8080/auth/github/callback&scope=read:user user:email"
    )
    return web.HTTPFound(github_auth_url)


@routes.get("/auth/github/callback")
async def github_callback(request):
    code = request.query.get("code")
    if not code:
        return web.HTTPBadRequest(reason="Missing code parameter")

    async with aiohttp.ClientSession() as session:
        # Exchange code for access token
        token_url = "https://github.com/login/oauth/access_token"
        token_data = {
            "client_id": GITHUB_CLIENT_ID,
            "client_secret": GITHUB_CLIENT_SECRET,
            "code": code,
        }
        token_headers = {"Accept": "application/json"}
        async with session.post(token_url, json=token_data, headers=token_headers) as resp:
            token_json = await resp.json()
            access_token = token_json.get("access_token")
            if not access_token:
                return web.HTTPBadRequest(reason="Failed to fetch access token")

        # Fetch user info
        user_url = "https://api.github.com/user"
        user_headers = {"Authorization": f"Bearer {access_token}"}
        async with session.get(user_url, headers=user_headers) as user_resp:
            user_data = await user_resp.json()

        # Redirect to /chat on frontend
        return web.HTTPFound(f"http://localhost:3000/chat")


async def redis_init(app):
    global redis
    redis = await aioredis.from_url(REDIS_URL)
    app["redis"] = redis


async def redis_cleanup(app):
    redis.close()
    await redis.wait_closed()


app = web.Application()
app.add_routes(routes)
app.on_startup.append(redis_init)
app.on_cleanup.append(redis_cleanup)

if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=8080)

import uuid
import os
import aiohttp
from aiohttp import web
import asyncio
from dotenv import load_dotenv
import secrets
import json
import asyncpg
import logging
import signal
from aiohttp_session import setup, get_session, session_middleware
from aiohttp_session.redis_storage import RedisStorage
import redis.asyncio as redis
import aiohttp_cors

# Load environment variables
load_dotenv()
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")
HOST = os.getenv("HOST")
FRONTEND_URL = os.getenv("FRONTEND_URL")
REDIS_URL = os.getenv("REDIS_URL")
POSTGRES_URL = os.getenv("POSTGRES_URL")

routes = web.RouteTableDef()
connections = set()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# GitHub Authentication =================================================================================================
@routes.get("/auth/github")
async def github_login(request):
    session = await get_session(request)
    state = secrets.token_urlsafe(16)
    session["oauth_state"] = state  # Store state in session
    github_auth_url = (
        f"https://github.com/login/oauth/authorize?"
        f"client_id={GITHUB_CLIENT_ID}&redirect_uri={HOST}/auth/github/callback&scope=read:user user:email&state={state}"
    )
    return web.HTTPFound(github_auth_url)

@routes.get("/auth/github/callback")
async def github_callback(request):
    session = await get_session(request)
    code = request.query.get("code")
    state = request.query.get("state")

    if not code or not state or state != session.get("oauth_state"):
        logger.error("Invalid or missing state/code parameter for GitHub OAuth")
        return web.HTTPBadRequest(reason="Invalid or missing state/code parameter")

    session.pop("oauth_state", None)  # Clear the state from the session

    async with aiohttp.ClientSession() as http_session:
        try:
            # Exchange code for access token
            token_url = "https://github.com/login/oauth/access_token"
            token_data = {
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code,
            }
            token_headers = {"Accept": "application/json"}
            async with http_session.post(token_url, json=token_data, headers=token_headers) as resp:
                if resp.status != 200:
                    logger.error(f"Failed to fetch access token: {resp.status}")
                    return web.HTTPBadRequest(reason="Failed to fetch access token")
                token_json = await resp.json()
                access_token = token_json.get("access_token")
                logger.info(f"Access token: {access_token}")
                if not access_token:
                    return web.HTTPBadRequest(reason="Failed to fetch access token")

            # Fetch user info
            user_url = "https://api.github.com/user"
            user_headers = {"Authorization": f"Bearer {access_token}"}
            async with http_session.get(user_url, headers=user_headers) as user_resp:
                if user_resp.status != 200:
                    logger.error(f"Failed to fetch user data: {user_resp.status}")
                    return web.HTTPBadRequest(reason="Failed to fetch user data")
                user_data = await user_resp.json()

            # logger.info(f"User data: {user_data}")

            # Store user data in session
            session["user_data"] = user_data

            # Redirect to frontend
            return web.HTTPFound(f"{FRONTEND_URL}/chat")

        except aiohttp.ClientError as e:
            logger.error(f"Network error during GitHub OAuth: {e}")
            return web.HTTPInternalServerError(reason="Network error during GitHub OAuth")

@routes.get("/auth/session")
async def get_session_data(request):
    session = await get_session(request)
    user_data = session.get("user_data")

    if user_data:
        logger.info(f"Authenticated user: {user_data['login']}")
        return web.json_response({
            "username": user_data["login"],
            "avatar": user_data["avatar_url"],
            "github_url": user_data["html_url"],
        })
    else:
        return web.json_response({"error": "Not authenticated"}, status=401)
    
@routes.get("/auth/signout")
async def signout(request):
    session = await get_session(request)
    session.clear()
    
    redis_client = request.app["redis"]
    session_id = session.identity
    await redis_client.delete(f"AIOHTTP_SESSION:{session_id}")
    
    return web.HTTPFound(f"{FRONTEND_URL}/")

# WebSocket Handler for Chat ===========================================================================================
@routes.get("/ws")
async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    redis_client = request.app["redis"]
    pg_pool = request.app["pg_pool"]

    connections.add(ws)

    async def redis_reader():
        """
        Read messages from Redis channel and broadcast them.
        """
        while True:
            message = await redis_client.blpop("chat", timeout=5)
            if message:
                _, data = message
                for conn in connections:
                    await conn.send_json(json.loads(data))

    redis_task = asyncio.create_task(redis_reader())

    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                data = json.loads(msg.data)

                # Save message to PostgreSQL
                async with pg_pool.acquire() as conn:
                    data = json.loads(msg.data)
                    data["id"] = str(uuid.uuid4())
                    
                    await conn.execute(
                        """
                        INSERT INTO messages (id, username, avatar, github_url, body, created_at)
                        VALUES ($1, $2, $3, $4, $5, NOW())
                        """,
                        data["id"],
                        data["username"],
                        data.get("avatar", None),
                        data.get("github_url", None),
                        data["body"],
                    )

                # Publish message to Redis
                await redis_client.rpush("chat", json.dumps(data))

    finally:
        connections.remove(ws)
        redis_task.cancel()
        try:
            await redis_task
        except asyncio.CancelledError:
            pass
        await ws.close()

    return ws


# Fetch Historical Messages ==============================================================================================
@routes.get("/api/messages")
async def get_messages(request):
    pg_pool = request.app["pg_pool"]
    async with pg_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM messages ORDER BY created_at ASC")
        return web.json_response([dict(row) for row in rows])


# Database Setup =======================================================================================================
async def init_db():
    conn = await asyncpg.connect(POSTGRES_URL)
    await conn.execute("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")
    await conn.execute(
        """
        CREATE TABLE IF NOT EXISTS messages (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            username TEXT NOT NULL,
            avatar TEXT,
            github_url TEXT,
            body TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
        """
    )
    await conn.close()

# Redis Setup ==========================================================================================================
async def setup_redis(app):
    # app["redis"] = redis.StrictRedis.from_url(REDIS_URL, decode_responses=True)
    app["redis"] = await connect_redis()
    storage = RedisStorage(app["redis"])
    setup(app, storage)

async def cleanup_redis(app):
    redis_client = app["redis"]
    if redis_client:
        await redis_client.close()


async def connect_redis():
    return await redis.from_url(REDIS_URL)

# PostgreSQL Setup =====================================================================================================
async def setup_postgres(app):
    await init_db()
    app["pg_pool"] = await asyncpg.create_pool(POSTGRES_URL)


async def cleanup_postgres(app):
    pg_pool = app["pg_pool"]
    await pg_pool.close()

# shutdown function ====================================================================================================
async def shutdown(signal, loop):
    """Cleanup tasks tied to the service's shutdown."""
    logging.info(f"Received exit signal {signal.name}...")
    tasks = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]

    [task.cancel() for task in tasks]

    logging.info("Cancelling outstanding tasks")
    await asyncio.gather(*tasks, return_exceptions=True)
    loop.stop()

# Application Setup ====================================================================================================
def create_app():
    app = web.Application()
    app.add_routes(routes)
    app.on_startup.append(setup_redis)
    app.on_cleanup.append(cleanup_redis)
    app.on_startup.append(setup_postgres)
    app.on_cleanup.append(cleanup_postgres)

    # set up cors
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
        )
    })
    
    for route in list(app.router.routes()):
        cors.add(route)
    
    async def on_shutdown(app):
        # Close all WebSocket connections
        for ws in connections:
            await ws.close(code=1001, message="Server shutdown")

    app.on_shutdown.append(on_shutdown)

    return app


if __name__ == "__main__":
    loop = asyncio.get_event_loop()

    # Handle signals for graceful shutdown
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(
            sig, lambda sig=sig: asyncio.create_task(shutdown(sig, loop))
        )

    app = create_app()
    web.run_app(app, host="0.0.0.0", port=8080, reuse_port=True)
import asyncio
from aiohttp import web
import aioredis
import os

# Load environment variables with default values
REDIS_URL = os.getenv('REDIS_URL', 'redis://localhost')
APP_PORT = int(os.getenv('APP_PORT', 8080))


# WebSocket handler for client connections
async def websocket_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    # Create a Redis connection
    redis = aioredis.from_url(REDIS_URL)
    pubsub = redis.pubsub()
    await pubsub.subscribe('chat')

    # Asynchronous function to read messages from Redis and send to WebSocket
    async def reader(pubsub):
        async for message in pubsub.listen():
            if message['type'] == 'message':
                await ws.send_str(message['data'].decode())

    # Start reading messages from the Redis channel
    asyncio.create_task(reader(pubsub))

    try:
        # Handle incoming WebSocket messages and publish them to Redis
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                await redis.publish('chat', msg.data)
    finally:
        # Cleanup Redis resources when the WebSocket is closed
        await pubsub.unsubscribe('chat')
        await redis.close()

    return ws


# Cleanup handler to close Redis connection on app shutdown
async def cleanup(app):
    if 'redis' in app:
        await app['redis'].close()


# Create Redis connection on app startup
async def create_redis_connection(app):
    app['redis'] = aioredis.from_url(REDIS_URL)


# Create the Aiohttp web application
app = web.Application()
# Add startup and cleanup tasks
app.on_startup.append(create_redis_connection)
app.on_cleanup.append(cleanup)
# Add WebSocket route
app.router.add_get('/ws', websocket_handler)

# Run the application
if __name__ == '__main__':
    web.run_app(app, host='0.0.0.0', port=APP_PORT)

# Discord VK Music Bot

Discord music bot for playing VK tracks through Lavalink and Shoukaku.

## Setup

1. Install bot dependencies:

```bash
cd bot
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env
```

3. Fill in Discord values in `bot/.env`.

4. Put `Lavalink.jar` into `lavalink/`.

5. Start Lavalink:

```bash
cd lavalink
java -jar Lavalink.jar
```

6. Start the bot:

```bash
cd bot
node index.js
```

## Commands

- `/play` - search and queue a VK track or playlist.
- `/queue` - show the current queue.
- `/nowplaying` - show the current track.
- `/skip` - skip the current track.
- `/pause` - pause playback.
- `/resume` - resume playback.
- `/stop` - stop playback and clear the queue.

# qBot

qBot is a discord bot written in typescript for the main purpose of flexing my stuff

## Features
    - Spotify Integration
      - Displays what im listening to in a chat
    - Direct Deposit alerts
      - Alerts the discord how much and when my direct deposit comes in
    - cool commands

i fucking hate writing readme.md files cuz they are so boring and take soo much time to do.

## Docker Setup

### Prerequisites
- Docker and Docker Compose installed
- Environment variables configured (see below)

### Quick Start

1. Create a `.env` file in the project root with your configuration:
```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
SPOTIFY_CALLBACK_PORT=3000
ADMINS=your_discord_user_id,another_admin_id
```

2. Build and start the container:
```bash
docker-compose up -d
```

3. View logs:
```bash
docker-compose logs -f
```

4. Stop the container:
```bash
docker-compose down
```

### Environment Variables

- `DISCORD_TOKEN` - Your Discord bot token (required)
- `DISCORD_CLIENT_ID` - Your Discord application client ID (required)
- `DISCORD_GUILD_ID` - Optional guild ID for guild-only commands (dev)
- `SPOTIFY_CLIENT_ID` - Spotify API client ID (required)
- `SPOTIFY_CLIENT_SECRET` - Spotify API client secret (required)
- `SPOTIFY_REDIRECT_URI` - OAuth redirect URI (default: http://localhost:3000/callback)
- `SPOTIFY_CALLBACK_PORT` - Port for OAuth callback server (default: 3000)
- `ADMINS` - Comma-separated list of Discord user IDs for admin commands
- `MUTE_SPOTIFY_DEBUG` - Set to "true" to mute Spotify debug logs (default: false)

### Data Persistence

The `data/` directory is mounted as a volume to persist:
- OAuth states
- Spotify user data
- Channel configurations
- Message IDs

Make sure the `data/` directory exists and has proper permissions.
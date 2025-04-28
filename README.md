[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hateonion/ozbargain-subscriber)

# OzBargain Subscriber

A Cloudflare Worker that fetches hot deals from OzBargain, filters them by vote count and category, and sends new deals to a Telegram channel.

## Features

- Fetches deals from multiple OzBargain RSS feeds
- Filters deals by positive votes and blacklisted categories
- Stores previously seen deals in Cloudflare KV to avoid duplicates
- Sends new hot deals to a Telegram chat via bot
- Configurable via environment variables

## Project Structure

- `worker.js`: Main Cloudflare Worker logic
- `xmlParser.js`: Parses OzBargain RSS XML feeds
- `wrangler.toml`: Cloudflare Worker configuration
- `wrangler.example.toml`: Example configuration

## Setup

1. **Configure Cloudflare Worker**
   - Copy `wrangler.example.toml` to `wrangler.toml` and update as needed.
   - Set up your KV namespace in the Cloudflare dashboard and update the `id` in `wrangler.toml`.

2. **Set Secrets**
   Store your Telegram bot token and chat ID:
   ```sh
   wrangler secret put TELEGRAM_BOT_TOKEN
   wrangler secret put TELEGRAM_CHAT_ID
   ```

3. **Deploy**
   ```sh
   wrangler deploy
   ```

## Configuration

- `HOT_DEAL_THRESHOLD`: Minimum positive votes for a deal to be considered "hot" (default: 100, can be overridden in `wrangler.toml`)
- `BLACKLISTED_CATEGORIES`: Categories to exclude (see `worker.js`)
- `URLS_TO_FETCH`: (Optional) JSON array of feed URLs to fetch

## Usage

- The worker runs on a schedule (every hour by default, see `crons` in `wrangler.toml`).
- New hot deals are sent to your Telegram chat automatically.

## How to Get Your Telegram Chat ID

To send messages to your Telegram chat, you need your chat ID. Here are two common ways to get it:

### 1. Using @userinfobot
1. Open Telegram and search for `@userinfobot`.
2. Start a chat with the bot and send any message.
3. The bot will reply with your user ID (for private chats) or the group ID (if used in a group).

### 2. Using Your Bot in a Group
1. Add your bot to a group.
2. Send a message in the group.
3. Use the following URL in your browser (replace `YOUR_BOT_TOKEN`):
   ```
   https://api.telegram.org/botYOUR_BOT_TOKEN/getUpdates
   ```
4. Look for the `chat` object in the response. The `id` field is your group chat ID.

> **Note:** For supergroups, the chat ID will be a negative number (e.g., `-1001234567890`).

## License

MIT

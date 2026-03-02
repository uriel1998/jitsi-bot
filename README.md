# Jitsi Bot (Fork)

This repository is a fork of [Bloodiko/jitsi-bot](https://github.com/Bloodiko/jitsi-bot).

This is also a really crap README, and I'll update it soon.


It includes browser-based bots for Jitsi Meet:
- Jitsi Bot (`jitsi-bot/`)
- Soundboard Bot (`soundboard/`)
- Streaming Bot (`streaming/`)
- Recording Bot (`recording/`)
- Chat Bot (`chatbot/`)

## Quick Start

1. Clone this repository.
2. Serve this whole directory from a web server (project root as web root).

```bash
python3 start_server.py
```

Alternative:

```bash
python3 -m http.server 5500
```

You can also use a more sophisticated web server (for example Nginx or Caddy), as long as it serves this repository root.

3. Open the launcher page (recommended):

```text
http://localhost:5500/
```

This launches the four main bots from `index.html`:
- Streaming Bot
- Chat Bot
- Soundboard Bot
- Recording Bot

4. Optional: open the single main bot directly:

```text
http://localhost:5500/jitsi-bot/jitsi.html?room=your-room-name
```

## Basic Usage

1. Join your target Jitsi room in a browser tab.
2. Open the bot page and enter the conference URL (or use `?room=...`).
3. Click `Toggle Bot`.
4. Send commands to the bot as **private messages** in Jitsi chat.

Note: on `meet.jit.si`, open the room manually first, then start the bot.

## Public meet.jit.si Note

On the public `meet.jit.si` instance, only the Chat Bot is typically reliable.

Use this hash suffix when joining on public Jitsi:

```text
#config.prejoinConfig.enabled=false&disableThirdPartyRequests=true
```

Example:

```text
http://localhost:5500/chatbot/chatbot.html?room=myroom&domain=meet.jit.si#config.prejoinConfig.enabled=false&disableThirdPartyRequests=true
```

## URL Parameters

Common query parameters:

```text
room=your-room-name
domain=meet.jit.si
bosh=https://meet.jit.si/http-bind
wsKeepAlive=/xmpp-websocket
useTurnUdp
disableAnonymousdomain
disableFocus
disableGuest
```

Example:

```text
http://localhost:5500/jitsi-bot/jitsi.html?room=myroom&domain=meet.jit.si
```

## Commands

Use `/help` in a private message to list all available commands.

Common commands:
- `/help`
- `/admin PASSWORD`
- `/reload`
- `/muteAll`
- `/setSubject SUBJECT`
- `/ban DISPLAYNAME`
- `/unban DISPLAYNAME`
- `/banlist`
- `/timeoutConf MINUTES`
- `/quit`
- `/joinSoundBot`
- `/joinStreamingBot`
- `/joinChatBot`
- `/joinRecordingBot`
- `/about`

The full command set is defined in `jitsi-bot/botCommands.js`.

## Assets

- `audio/` contains sample audio files used by bot features.
- `images/` contains screenshots and icons.
- Some media files are included for demonstration purposes and remain the property of their respective owners.

## Merge Recording Chunks (ffmpeg)

If you have split recording chunks:

1. Create `chunk_list.txt` with ordered entries:

```text
file 'recording_YYYYMMDD_HHMMSS_part0001.webm'
file 'recording_YYYYMMDD_HHMMSS_part0002.webm'
```

2. Merge with ffmpeg:

```bash
ffmpeg -f concat -safe 0 -i ./chunk_list.txt -c copy ./recording_merged.webm
```

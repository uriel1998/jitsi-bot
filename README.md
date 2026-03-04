# Jitsi Bot (Fork)

This repository is a fork of [Bloodiko/jitsi-bot](https://github.com/Bloodiko/jitsi-bot) with a lot of additional features.


It includes browser-based bots for Jitsi Meet:
- Soundboard Bot (`soundboard/`)
- Streaming Bot (`streaming/`)
- Recording Bot (`recording/`)
- Chat Bot (`chatbot/`)

## Quick Start

### From GitHub Pages

Go to <a href="https://uriel1998.github.io/jitsi-bot/">https://uriel1998.github.io/jitsi-bot/</a>.

### Self-Hosting

1. Clone this repository.
2. Serve this whole directory from a web server (project root as web root).

```bash
python3 start_server.py
```

You can also use a more sophisticated web server (for example Nginx or Caddy), as long as it serves this repository root.

3. Open the launcher page:

```text
http://localhost:5500/
```

This launches the four main bots from `index.html`:
- Streaming Bot
- Chat Bot
- Soundboard Bot
- Recording Bot

## Basic Usage

1. Join your target Jitsi room in a browser tab. See below about the public instance.
2. Open the bot page and enter the conference URL.
3. Click `Toggle Bot`.
4. You can either `Toggle Bot` or `Reset Bot` to unload the bot.



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

### Bot-Specific Usage

- Pokpoko will stream mp3/ogg from an https stream into the audio of the conference. Put the full source URL in "Audio Source Input" and "Set Source".
- Kobuko will respond to multiple commands in the text chat of the conference; try !command.  You can load your own text into `/lib/Custom` for it to respond with. 
- Mochi will pipe audio from a virtual microphone into the audio of the conference. Have a virtual microphone set up *prior* to loading the bot; examples are linked on the bot's loading page. When the bot loads, choose the virtual microphone your app (such as Kenku) is playing on.
- Ritson will record audio from the conference. It plays an audio file when it begins and ends recording, as well as a ping every few minutes and a text chat alert. It saves the audio every few minutes in a `webm` file in your browser's download directory.  Once you're done recording, follow the instructions (or use the helper scripts) to stitch the audio back together. 


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

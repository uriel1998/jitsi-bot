# Jitsi Bot (Fork)

This repository is a fork of [Bloodiko/jitsi-bot](https://github.com/Bloodiko/jitsi-bot) with a lot of additional features.


It includes browser-based bots for Jitsi Meet:
- Soundboard Bot (`soundboard/`)
- Streaming Bot (`streaming/`)
- Recording Bot (`recording/`)
- Chat Bot (`chatbot/`)

## Known Issues

These are active issues and should be treated as current limitations:

- Chrome/Chromium recording is unreliable. Firefox is currently the browser to use for the Recording Bot.
- The Recording Bot now records a single mixed conference audio stream, not separate participant recordings.
- Both the Streaming Bot and Recording Bot appear to stop or disconnect after roughly one hour of runtime in current testing.
- Current debugging also includes checking whether automatic browser tab unloading is causing the one-hour stop/disconnect behavior.
- The Chrome/Chromium recording problem and the roughly one-hour bot disconnect problem are both tracked in the project issue tracker.

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

Use this hash suffix for the meeting room URL for the bot when joining on public Jitsi:

```text
#config.prejoinConfig.enabled=false&disableThirdPartyRequests=true
```

Example:

```text
https://meet.jit.si/YourMeetingRoomName#config.prejoinConfig.enabled=false&disableThirdPartyRequests=true
```

### Bot-Specific Usage

- Pokpoko will stream mp3/ogg from an https stream into the audio of the conference. Put the full source URL in "Audio Source Input" and "Set Source".
- Kobuko will respond to multiple commands in the text chat of the conference; try !command.  You can load your own text into `/lib/Custom` for it to respond with. 
- Mochi will pipe audio from a virtual microphone into the audio of the conference. Have a virtual microphone set up *prior* to loading the bot; examples are linked on the bot's loading page. When the bot loads, choose the virtual microphone your app (such as Kenku) is playing on.
- Ritson records a single mixed conference audio stream from the room. After joining the room, you must specifically tell it to begin recording.
- When the local helper server from `start_server.py` is running, the Recording Bot prefers uploading chunks to the server so they can be appended into one recording file under `recording_tests/`.
- If the local helper server is not available, the Recording Bot falls back to browser downloads.
- It sends text chat notifications when recording begins, when it ends, and periodically while recording.
- Firefox is currently the preferred browser for recording. Chrome/Chromium recording remains unreliable.


## Assets

- `audio/` contains sample audio files used by bot features.
- `images/` contains screenshots and icons.
- Some media files are included for demonstration purposes and remain the property of their respective owners.

## Merge Recording Chunks

These merge scripts are mainly for the fallback download mode where the browser saves split chunk files. If the local helper server is running and receiving recording uploads, the preferred behavior is a single server-side recording file instead of many standalone browser downloads.

`ffmpeg` must be installed and available on your `PATH` before running any merge script.

Install instructions:

- Windows: [FFmpeg download page (Windows builds)](https://www.ffmpeg.org/download.html)
- Linux: [FFmpeg download page (Linux packages)](https://www.ffmpeg.org/download.html)
- macOS: [Homebrew `ffmpeg` formula](https://formulae.brew.sh/formula/ffmpeg)

If the Recording Bot saves split `.webm` chunks, use the helper script for your OS:

- Linux: `./merge_recordings_linux.sh`
- macOS: `./merge_recordings_macos.sh`
- PowerShell: `.\merge_recordings.ps1`

Each script scans the current directory for files matching:

```text
recording_YYYYMMDD_HHMMSS_partNNNN.webm
recording_YYYYMMDD_HHMMSS_<participant>_partNNNN.webm
recording_YYYYMMDD_HHMMSS__<participant>_partNNNN.webm
```

The scripts group chunks by timestamp and participant name, merge each ordered chunk set with `ffmpeg`, and write outputs under `./recording/<timestamp>/`.

Examples:

```text
recording_20260310_185513_T3_69337f62_part0001.webm
  -> ./recording/20260310_185513/T3_69337f62.webm

recording_20260310_185513_Steven_58170157_part0001.webm
recording_20260310_185513_Steven_58170157_part0002.webm
  -> ./recording/20260310_185513/Steven_58170157.webm

recording_20260310_185513__Ponpoko_cf8c3192_part0001.webm
recording_20260310_185513__Ponpoko_cf8c3192_part0002.webm
  -> ./recording/20260310_185513/Ponpoko_cf8c3192.webm

recording_20260310_185513_part0001.webm
recording_20260310_185513_part0002.webm
  -> ./recording/20260310_185513/recording.webm
```

Run any script with `--help` to print usage and examples.

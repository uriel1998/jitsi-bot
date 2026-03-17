/**
 * Credit: Jimmi Music Bot for Jitsi https://github.com/Music-Bot-for-Jitsi/Jimmi
 */

const streaming = document.querySelector('#streaming')

streaming.volume = 0.1

let streamingContext = undefined
let destStream = undefined
let initDone = false
let lastStreamingProgressAt = 0
let lastStreamingTime = 0
let streamingHealthIntervalId = undefined

let playJoinSound = true

const streamingHealthLogIntervalMs = 60 * 1000

function summarizeStreamingMemory() {
  const mem = performance?.memory
  if (!mem) {
    return { available: false }
  }
  return {
    available: true,
    usedJSHeapSize: mem.usedJSHeapSize,
    totalJSHeapSize: mem.totalJSHeapSize,
    jsHeapSizeLimit: mem.jsHeapSizeLimit,
  }
}

function summarizeUserActivation() {
  return {
    isActive: document.userActivation?.isActive ?? null,
    hasBeenActive: document.userActivation?.hasBeenActive ?? null,
  }
}

function summarizeStreamingElementState() {
  if (!streaming) {
    return { missing: true }
  }

  const mediaError = streaming.error
    ? {
        code: streaming.error.code,
        message: streaming.error.message || '',
      }
    : null

  return {
    currentSrc: streaming.currentSrc || streaming.src || '',
    readyState: streaming.readyState,
    networkState: streaming.networkState,
    paused: streaming.paused,
    ended: streaming.ended,
    muted: streaming.muted,
    volume: streaming.volume,
    crossOrigin: streaming.crossOrigin || '',
    currentTime: Number.isFinite(streaming.currentTime)
      ? Number(streaming.currentTime.toFixed(3))
      : null,
    duration: Number.isFinite(streaming.duration)
      ? Number(streaming.duration.toFixed(3))
      : null,
    error: mediaError,
    lastProgressAt: lastStreamingProgressAt || null,
    msSinceProgress: lastStreamingProgressAt
      ? Date.now() - lastStreamingProgressAt
      : null,
  }
}

function summarizeDestStreamState() {
  const audioTrack = destStream?.stream?.getAudioTracks?.()?.[0]
  return {
    hasDestStream: Boolean(destStream?.stream),
    audioTrackCount: destStream?.stream?.getAudioTracks?.()?.length ?? 0,
    audioTrackEnabled: audioTrack?.enabled ?? null,
    audioTrackMuted: audioTrack?.muted ?? null,
    audioTrackReadyState: audioTrack?.readyState ?? null,
    audioTrackLabel: audioTrack?.label || '',
  }
}

function summarizeStreamingRuntimeState() {
  return {
    streaming: summarizeStreamingElementState(),
    dest: summarizeDestStreamState(),
    userActivation: summarizeUserActivation(),
    audioContextState: streamingContext?.state || 'missing',
    initDone,
    roomJoined: window.roomJoined ?? null,
    connectionEstablished: window.connectionEstablished ?? null,
    memory: summarizeStreamingMemory(),
  }
}

async function persistStreamingLog(level, message, details = {}) {
  const payload = JSON.stringify({
    ts: new Date().toISOString(),
    page: window.location.pathname,
    level,
    message,
    details,
  })

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' })
      if (navigator.sendBeacon('/__client_log', blob)) {
        return
      }
    }
  } catch (error) {
    console.log('sendBeacon streaming logging failed', error)
  }

  try {
    await fetch('/__client_log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    })
  } catch (error) {
    console.log('fetch streaming logging failed', error)
  }
}

function streamingVerboseLog(message, details = {}) {
  const detailText =
    details && Object.keys(details).length ? ` ${JSON.stringify(details)}` : ''
  log(`${message}${detailText}`)
  void persistStreamingLog('info', message, details)
}

function streamingWarningLog(message, details = {}) {
  const detailText =
    details && Object.keys(details).length ? ` ${JSON.stringify(details)}` : ''
  log(`${message}${detailText}`)
  void persistStreamingLog('warning', message, details)
}

function attachStreamingCrashSignalLogging() {
  window.addEventListener('error', (event) => {
    void persistStreamingLog('error', 'window.error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error?.stack || String(event.error || ''),
      runtime: summarizeStreamingRuntimeState(),
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    void persistStreamingLog('error', 'window.unhandledrejection', {
      reason: event.reason?.stack || String(event.reason || ''),
      runtime: summarizeStreamingRuntimeState(),
    })
  })

  document.addEventListener('visibilitychange', () => {
    void persistStreamingLog('info', 'document.visibilitychange', {
      visibilityState: document.visibilityState,
      runtime: summarizeStreamingRuntimeState(),
    })
  })

  window.addEventListener('pagehide', () => {
    void persistStreamingLog('warning', 'window.pagehide', {
      runtime: summarizeStreamingRuntimeState(),
    })
  })

  window.addEventListener('beforeunload', () => {
    void persistStreamingLog('warning', 'window.beforeunload', {
      runtime: summarizeStreamingRuntimeState(),
    })
  })
}

function stopStreamingHealthLogging() {
  if (!streamingHealthIntervalId) {
    return
  }
  clearInterval(streamingHealthIntervalId)
  streamingHealthIntervalId = undefined
}

function startStreamingHealthLogging() {
  stopStreamingHealthLogging()
  streamingHealthIntervalId = setInterval(() => {
    streamingVerboseLog('Streaming health heartbeat', summarizeStreamingRuntimeState())
    if (
      lastStreamingProgressAt &&
      Date.now() - lastStreamingProgressAt > streamingHealthLogIntervalMs * 2
    ) {
      streamingWarningLog('Streaming media element has not advanced recently', summarizeStreamingRuntimeState())
    }
    if (streaming?.ended || streaming?.readyState === HTMLMediaElement.HAVE_NOTHING) {
      streamingWarningLog('Streaming media element is ended or empty during heartbeat', summarizeStreamingRuntimeState())
    }
  }, streamingHealthLogIntervalMs)
}

function noteStreamingProgress(reason) {
  const now = Date.now()
  const currentTime = Number.isFinite(streaming?.currentTime)
    ? Number(streaming.currentTime.toFixed(3))
    : null
  const progressed =
    currentTime !== null && (lastStreamingTime === 0 || currentTime !== lastStreamingTime)
  if (progressed) {
    lastStreamingProgressAt = now
    lastStreamingTime = currentTime
  }
  streamingVerboseLog(`Streaming progress signal: ${reason}`, {
    currentTime,
    progressed,
    runtime: summarizeStreamingRuntimeState(),
  })
}

function logStreamingDiagnostics(context) {
  streamingVerboseLog(context, summarizeStreamingRuntimeState())
}

function logStreamingSourceOrigin(urlLike) {
  try {
    const sourceUrl = new URL(urlLike, window.location.href)
    streamingVerboseLog('Streaming source origin check', {
      sourceOrigin: sourceUrl.origin,
      pageOrigin: window.location.origin,
      sameOrigin: sourceUrl.origin === window.location.origin,
      href: sourceUrl.href,
    })
  } catch (error) {
    streamingWarningLog('Streaming source origin check failed', {
      error: error?.message || String(error),
    })
  }
}

function playStreamingIfConnected() {
  if (!roomJoined) {
    logStreamingDiagnostics('Skipped play request because room is not joined yet')
    return
  }

  logStreamingDiagnostics('Attempting streaming.play()')
  const playPromise = streaming.play()
  if (playPromise && typeof playPromise.then === 'function') {
    playPromise.then(() => {
      logStreamingDiagnostics('streaming.play() resolved')
    })
  }
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch((error) => {
      log(
        `Auto-play failed for loaded stream: ${error?.message || error}; diagnostics=${summarizeStreamingElementState()}; userActivation=${summarizeUserActivation()}`
      )
      void persistStreamingLog('warning', 'streaming.play() rejected', {
        error: error?.message || String(error),
        runtime: summarizeStreamingRuntimeState(),
      })
    })
  }
}

window.playStreamingIfConnected = playStreamingIfConnected
window.logStreamingDiagnostics = logStreamingDiagnostics
window.persistStreamingLog = persistStreamingLog
window.streamingVerboseLog = streamingVerboseLog
window.streamingWarningLog = streamingWarningLog
window.getStreamingRuntimeState = summarizeStreamingRuntimeState

function initAudio() {
  if (!streaming) {
    console.error('Error with Streaming Audio Element.')
    return
  }

  const audioContext = new AudioContext()
  streamingContext = audioContext
  const track = audioContext.createMediaElementSource(streaming)
  destStream = audioContext.createMediaStreamDestination()

  track.connect(destStream)

  streamingVerboseLog('InitAudio - Preparing Audio Stream', {
    audioContextAllowed: audioContext.state !== 'suspended',
    autoplayEnvironment: {
      iframe: window.self !== window.top,
      autoplayAllowed:
        document.featurePolicy?.allowsFeature?.('autoplay') ?? 'unknown',
    },
    runtime: summarizeStreamingRuntimeState(),
  })
  logStreamingDiagnostics('Streaming audio initialized')

  audioContext.addEventListener('statechange', () => {
    streamingVerboseLog('AudioContext state changed', summarizeStreamingRuntimeState())
  })

  const destTrack = destStream.stream.getAudioTracks()[0]
  if (destTrack) {
    destTrack.addEventListener('ended', () => {
      streamingWarningLog('Destination audio track ended', summarizeStreamingRuntimeState())
    })
    destTrack.addEventListener('mute', () => {
      streamingWarningLog('Destination audio track muted', summarizeStreamingRuntimeState())
    })
    destTrack.addEventListener('unmute', () => {
      streamingVerboseLog('Destination audio track unmuted', summarizeStreamingRuntimeState())
    })
  } else {
    streamingWarningLog('Destination audio stream was created without an audio track.')
  }

  navigator.mediaDevices.getUserMedia = async function ({ audio, video }) {
    console.log({ audio, video })
    streamingVerboseLog(
      'UserMedia is being accessed. Returning corresponding context stream.',
      {
        audioRequested: Boolean(audio),
        videoRequested: Boolean(video),
        runtime: summarizeStreamingRuntimeState(),
      }
    )
    logStreamingDiagnostics(
      `getUserMedia interception before resume (audio=${Boolean(audio)}, video=${Boolean(video)})`
    )
    await audioContext.resume()
    logStreamingDiagnostics(
      `getUserMedia interception after resume (audio=${Boolean(audio)}, video=${Boolean(video)})`
    )
    if (audio) {
      return destStream.stream
    }
    return destStream.stream
  }

  initDone = true
}

document
  .querySelector('#streamingInputForm')
  ?.addEventListener('submit', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    const streamingSourceInput = document.querySelector('#streamingSourceInput')
    if (!streamingSourceInput.validity.valid) {
      return false
    }
    try {
      log(`Trying to load URL ${streamingSourceInput.value}`)
      logStreamingSourceOrigin(streamingSourceInput.value)
      streaming.src = streamingSourceInput.value
      logStreamingDiagnostics('Assigned new streaming.src value')
      playStreamingIfConnected()
      streamingSourceInput.value = ''
    } catch (error) {
      console.log(error)
      log(`Error Loading Audiofile.`)
    }
  })

for (const eventName of [
  'loadstart',
  'loadedmetadata',
  'loadeddata',
  'canplay',
  'canplaythrough',
  'play',
  'playing',
  'pause',
  'waiting',
  'stalled',
  'suspend',
  'emptied',
  'abort',
  'ended',
  'error',
]) {
  streaming.addEventListener(eventName, () => {
    logStreamingDiagnostics(`Streaming media event: ${eventName}`)
    if (
      eventName === 'playing' ||
      eventName === 'canplay' ||
      eventName === 'canplaythrough' ||
      eventName === 'timeupdate'
    ) {
      noteStreamingProgress(eventName)
    }
    if (eventName === 'loadedmetadata') {
      playStreamingIfConnected()
    }
  })
}

streaming.addEventListener('timeupdate', () => {
  noteStreamingProgress('timeupdate')
})

attachStreamingCrashSignalLogging()
startStreamingHealthLogging()

initAudio()

function getStreamingCurrentTrackName() {
  try {
    let splittedPath = new URL(streaming.src).pathname.split('/')
    return splittedPath[splittedPath.length - 1].split('.')[0]
  } catch {
    return ''
  }
}

function printParticipants() {
  const participants = room.getParticipants()
  const html_participantsInner = document.querySelector('#participantsInner')

  html_participantsInner.innerHTML = ''

  participants.forEach((participant) => {
    const part_element = document.createElement('div')
    part_element.textContent = `${participant.getStatsID()}: ${participant._displayName.replaceAll(
      / +/g,
      ' '
    )} ${participant.isModerator() ? '👑' : ''}`
    participant.isModerator() && part_element.classList.add('isModerator')
    part_element.classList.add('participant')
    html_participantsInner.append(part_element)
  })
}

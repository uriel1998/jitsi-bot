/**
 * Credit: Jimmi Music Bot for Jitsi https://github.com/Music-Bot-for-Jitsi/Jimmi
 */

const streaming = document.querySelector('#streaming')

streaming.volume = 0.1

let streamingContext = undefined
let destStream = undefined
let initDone = false

let playJoinSound = true

function summarizeUserActivation() {
  return JSON.stringify({
    isActive: document.userActivation?.isActive ?? null,
    hasBeenActive: document.userActivation?.hasBeenActive ?? null,
  })
}

function summarizeStreamingElementState() {
  if (!streaming) {
    return 'streaming element missing'
  }

  const mediaError = streaming.error
    ? {
        code: streaming.error.code,
        message: streaming.error.message || '',
      }
    : null

  return JSON.stringify({
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
  })
}

function summarizeDestStreamState() {
  const audioTrack = destStream?.stream?.getAudioTracks?.()?.[0]
  return JSON.stringify({
    hasDestStream: Boolean(destStream?.stream),
    audioTrackCount: destStream?.stream?.getAudioTracks?.()?.length ?? 0,
    audioTrackEnabled: audioTrack?.enabled ?? null,
    audioTrackMuted: audioTrack?.muted ?? null,
    audioTrackReadyState: audioTrack?.readyState ?? null,
    audioTrackLabel: audioTrack?.label || '',
  })
}

function logStreamingDiagnostics(context) {
  log(
    `${context} | element=${summarizeStreamingElementState()} | dest=${summarizeDestStreamState()} | userActivation=${summarizeUserActivation()}`
  )
}

function logStreamingSourceOrigin(urlLike) {
  try {
    const sourceUrl = new URL(urlLike, window.location.href)
    log(
      `Streaming source origin check: sourceOrigin=${sourceUrl.origin}, pageOrigin=${window.location.origin}, sameOrigin=${
        sourceUrl.origin === window.location.origin
      }`
    )
  } catch (error) {
    log(`Streaming source origin check failed: ${error?.message || error}`)
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
    })
  }
}

window.playStreamingIfConnected = playStreamingIfConnected
window.logStreamingDiagnostics = logStreamingDiagnostics

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

  log('InitAudio - Preparing Audio Stream')
  log(`AudioContext allowed: ${audioContext.state !== 'suspended'}`)
  log(
    `Autoplay environment: iframe=${window.self !== window.top}, autoplayAllowed=${
      document.featurePolicy?.allowsFeature?.('autoplay') ?? 'unknown'
    }, userActivation=${summarizeUserActivation()}`
  )
  logStreamingDiagnostics('Streaming audio initialized')

  audioContext.addEventListener('statechange', () => {
    log(
      `AudioContext state changed to ${audioContext.state}; userActivation=${summarizeUserActivation()}`
    )
  })

  const destTrack = destStream.stream.getAudioTracks()[0]
  if (destTrack) {
    destTrack.addEventListener('ended', () => {
      log(`Destination audio track ended; state=${summarizeDestStreamState()}`)
    })
    destTrack.addEventListener('mute', () => {
      log(`Destination audio track muted; state=${summarizeDestStreamState()}`)
    })
    destTrack.addEventListener('unmute', () => {
      log(`Destination audio track unmuted; state=${summarizeDestStreamState()}`)
    })
  } else {
    log('Destination audio stream was created without an audio track.')
  }

  navigator.mediaDevices.getUserMedia = async function ({ audio, video }) {
    console.log({ audio, video })
    log(
      'UserMedia is being Accessed. - Returning corresponding context stream.'
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
    if (eventName === 'loadedmetadata') {
      playStreamingIfConnected()
    }
  })
}

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

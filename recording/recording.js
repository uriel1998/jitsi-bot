/**
 * Credit: Jimmi Music Bot for Jitsi https://github.com/Music-Bot-for-Jitsi/Jimmi
 */

const recording = document.querySelector('#recording')
const videoboard = document.querySelector('#videoboard')
const recordingLevelBar = document.querySelector('#recordingLevelBar')
const recordingLevelValue = document.querySelector('#recordingLevelValue')

recording.volume = 0.1
videoboard.volume = 0.1

let gainNode = undefined
let recordingContext = undefined

let destStream = undefined

let initDone = false

let playJoinSound = true
let recordingSessionStarted = false
let recorderTargetName = undefined
let mediaRecorder = undefined
let recordedChunks = []
const remoteAudioNodes = new WeakMap()
const pendingRemoteAudioTracks = new Set()
let recordingLevelAnalyser = undefined
let recordingLevelData = undefined
let recordingLevelRafId = undefined

const recordingOnCueUrl = 'http://127.0.0.1:5500/audio/_on.webm'
const recordingOffCueUrl = 'http://127.0.0.1:5500/audio/_off.webm'

function getCueSourceCandidates(primaryCueUrl, cueFileName) {
  const sameOriginCue = new URL(`/audio/${cueFileName}`, window.location.origin).toString()
  return [...new Set([sameOriginCue, primaryCueUrl])]
}

function makeTimestamp() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`
}

function getDefaultRecordingFilename() {
  return `recording_${makeTimestamp()}.webm`
}

function getRecorderMimeType() {
  if (window.MediaRecorder?.isTypeSupported('audio/webm;codecs=opus')) {
    return 'audio/webm;codecs=opus'
  }
  if (window.MediaRecorder?.isTypeSupported('audio/webm')) {
    return 'audio/webm'
  }
  return ''
}

async function promptForRecordingTarget() {
  const suggestedName = getDefaultRecordingFilename()
  if (window.showSaveFilePicker) {
    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: 'WebM audio',
            accept: { 'audio/webm': ['.webm'] },
          },
        ],
      })
      recorderTargetName = fileHandle.name || suggestedName
      return { mode: 'file-system', handle: fileHandle }
    } catch (error) {
      if (error?.name === 'AbortError') {
        log('Recording file selection was cancelled.')
        return undefined
      }
      throw error
    }
  }

  const userName = window.prompt('Recording filename (.webm):', suggestedName)
  if (userName === null) {
    log('Recording file selection was cancelled.')
    return undefined
  }
  const safeName = userName.trim().endsWith('.webm')
    ? userName.trim()
    : `${userName.trim() || 'recording'}.webm`
  recorderTargetName = safeName
  return { mode: 'download', filename: safeName }
}

function waitForPlaybackEnd(audioElement) {
  return new Promise((resolve) => {
    const finish = () => {
      audioElement.removeEventListener('ended', finish)
      audioElement.removeEventListener('error', finish)
      resolve()
    }
    audioElement.addEventListener('ended', finish, { once: true })
    audioElement.addEventListener('error', finish, { once: true })
  })
}

async function playRecordingCue(cueType = 'on') {
  const previousSrc = recording.src
  const previousLoop = recording.loop
  const wasPaused = recording.paused

  recording.pause()
  recording.loop = false
  const cueFileName = cueType === 'off' ? '_off.webm' : '_on.webm'
  const primaryCueUrl = cueType === 'off' ? recordingOffCueUrl : recordingOnCueUrl
  const cueCandidates = getCueSourceCandidates(primaryCueUrl, cueFileName)

  try {
    let played = false
    for (const cueSrc of cueCandidates) {
      recording.src = cueSrc
      try {
        await recording.play()
        await waitForPlaybackEnd(recording)
        played = true
        break
      } catch (error) {
        log(`Cue source failed (${cueSrc}): ${error?.message || error}`)
      }
    }
    if (!played) {
      log('Failed to play cue sound from all configured sources.')
    }
  } finally {
    recording.pause()
    recording.src = previousSrc
    recording.loop = previousLoop
    if (!wasPaused) {
      try {
        await recording.play()
      } catch (error) {
        log('Unable to resume previous recording source after cue playback.')
      }
    }
  }
}

function startMediaRecorder() {
  if (!destStream?.stream) {
    log('Cannot start recording: destination stream not ready.')
    return false
  }
  if (!window.MediaRecorder) {
    log('Cannot start recording: MediaRecorder is not supported.')
    return false
  }

  recordedChunks = []
  const mimeType = getRecorderMimeType()
  const recorderOptions = mimeType ? { mimeType } : undefined
  mediaRecorder = new MediaRecorder(destStream.stream, recorderOptions)

  mediaRecorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) {
      recordedChunks.push(event.data)
    }
  })

  mediaRecorder.start(1000)
  log(`Recording started: ${recorderTargetName || getDefaultRecordingFilename()}`)
  return true
}

async function saveRecordedChunks(target) {
  const mimeType = getRecorderMimeType() || 'audio/webm'
  const blob = new Blob(recordedChunks, { type: mimeType })

  if (target.mode === 'file-system') {
    const writable = await target.handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return target.handle.name || recorderTargetName || getDefaultRecordingFilename()
  }

  const downloadName = target.filename || recorderTargetName || getDefaultRecordingFilename()
  const downloadUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = downloadUrl
  a.download = downloadName
  a.click()
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
  return downloadName
}

let recordingTarget = undefined

async function startAutomatedRecordingFlow() {
  if (recordingSessionStarted) {
    return false
  }
  recordingSessionStarted = true

  try {
    recordingTarget = await promptForRecordingTarget()
    if (!recordingTarget) {
      recordingSessionStarted = false
      return false
    }

    await playRecordingCue('on')
    const started = startMediaRecorder()
    if (!started) {
      recordingSessionStarted = false
      return false
    }
    return true
  } catch (error) {
    recordingSessionStarted = false
    log(`Failed to start automated recording flow: ${error?.message || error}`)
    return false
  }
}

function stopMediaRecorder() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      resolve(false)
      return
    }
    mediaRecorder.addEventListener(
      'stop',
      () => {
        resolve(true)
      },
      { once: true }
    )
    mediaRecorder.stop()
  })
}

function updateRecordingLevelMeter() {
  if (!recordingLevelAnalyser || !recordingLevelData) {
    return
  }

  recordingLevelAnalyser.getFloatTimeDomainData(recordingLevelData)
  let sumSquares = 0
  for (let i = 0; i < recordingLevelData.length; i++) {
    const sample = recordingLevelData[i]
    sumSquares += sample * sample
  }
  const rms = Math.sqrt(sumSquares / recordingLevelData.length)
  const meterPercent = Math.min(100, Math.round(rms * 250))

  if (recordingLevelBar) {
    recordingLevelBar.style.width = `${meterPercent}%`
  }
  if (recordingLevelValue) {
    recordingLevelValue.textContent = `${meterPercent}%`
  }

  recordingLevelRafId = window.requestAnimationFrame(updateRecordingLevelMeter)
}

function initRecordingLevelMeter(audioContext) {
  if (!audioContext || !destStream?.stream || !recordingLevelBar) {
    return
  }

  if (recordingLevelRafId) {
    window.cancelAnimationFrame(recordingLevelRafId)
    recordingLevelRafId = undefined
  }

  const meterSource = audioContext.createMediaStreamSource(destStream.stream)
  recordingLevelAnalyser = audioContext.createAnalyser()
  recordingLevelAnalyser.fftSize = 2048
  recordingLevelData = new Float32Array(recordingLevelAnalyser.fftSize)
  meterSource.connect(recordingLevelAnalyser)
  updateRecordingLevelMeter()
}

async function stopAutomatedRecordingFlow() {
  const stopped = await stopMediaRecorder()
  if (stopped && recordingTarget) {
    try {
      const savedAs = await saveRecordedChunks(recordingTarget)
      log(`Recording saved to ${savedAs}`)
    } catch (error) {
      log(`Failed to save recording: ${error?.message || error}`)
    }
  } else {
    log('No active recording to stop.')
  }

  await playRecordingCue('off')
}

function initAudio() {
  if (!recording) {
    console.error('Error with Recording Audio Element.')
  }

  const audioContext = new AudioContext()
  recordingContext = audioContext
  const videoAudio = audioContext.createMediaElementSource(videoboard)
  const track = audioContext.createMediaElementSource(recording)
  destStream = audioContext.createMediaStreamDestination()
  initRecordingLevelMeter(audioContext)

  videoAudio.connect(destStream)
  track.connect(destStream)

  log('InitAudio - Preparing Audio Stream')
  log(`AudioContext allowed: ${audioContext.state !== 'suspended'}`)
  navigator.mediaDevices.getUserMedia = async function ({ audio, video }) {
    console.log({ audio, video })
    log(
      'UserMedia is being Accessed. - Returning corresponding context stream.'
    )

    await audioContext.resume()
    if (audio) {
      return destStream.stream
    }
    if (video) {
      const videoStream = new MediaStream()
      videoStream.addTrack(videoboard.captureStream().getVideoTracks()[0])
      return videoStream
    }
    return destStream.stream
  }

  initDone = true
  flushPendingRemoteAudioTracks()
}

document
  .querySelector('#recordingInputForm')
  ?.addEventListener('submit', (ev) => {
    ev.preventDefault()
    ev.stopPropagation()
    const recordingSourceInput = document.querySelector('#recordingSourceInput')
    if (!recordingSourceInput.validity.valid) {
      return false
    }
    try {
      log(`Trying to load URL ${recordingSourceInput.value}`)
      recording.src = recordingSourceInput.value
      recordingSourceInput.value = ''
    } catch (error) {
      console.log(error)
      log(`Error Loading Audiofile.`)
    }
  })

initAudio()

function getRecordingCurrentTrackName() {
  let splittedPath = new URL(recording.src).pathname.split('/')

  return splittedPath[splittedPath.length - 1].split('.')[0]
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

window.startAutomatedRecordingFlow = startAutomatedRecordingFlow
window.stopAutomatedRecordingFlow = stopAutomatedRecordingFlow

function connectRemoteAudioTrack(track) {
  if (!recordingContext || !destStream?.stream || !track) {
    return false
  }
  if (track.getType?.() !== 'audio') {
    return false
  }

  if (remoteAudioNodes.has(track)) {
    return true
  }

  const originalStream = track.getOriginalStream?.()
  if (!originalStream || originalStream.getAudioTracks().length === 0) {
    log('Remote audio track has no original audio stream.')
    return false
  }

  try {
    const sourceNode = recordingContext.createMediaStreamSource(originalStream)
    const gainNode = recordingContext.createGain()
    gainNode.gain.value = 1
    sourceNode.connect(gainNode)
    gainNode.connect(destStream)
    remoteAudioNodes.set(track, { sourceNode, gainNode })
    return true
  } catch (error) {
    log(`Failed to connect remote audio track: ${error?.message || error}`)
    return false
  }
}

function flushPendingRemoteAudioTracks() {
  if (!recordingContext || !destStream?.stream || pendingRemoteAudioTracks.size === 0) {
    return
  }

  for (const track of [...pendingRemoteAudioTracks]) {
    if (connectRemoteAudioTrack(track)) {
      pendingRemoteAudioTracks.delete(track)
    }
  }
}

window.registerRemoteAudioTrackForRecording = (track) => {
  if (!track || track.getType?.() !== 'audio') {
    return
  }
  if (!initDone || !recordingContext || !destStream?.stream) {
    pendingRemoteAudioTracks.add(track)
    return
  }
  connectRemoteAudioTrack(track)
}

window.unregisterRemoteAudioTrackForRecording = (track) => {
  if (!track || track.getType?.() !== 'audio') {
    return
  }
  pendingRemoteAudioTracks.delete(track)
  const nodes = remoteAudioNodes.get(track)
  if (!nodes) {
    return
  }
  try {
    nodes.sourceNode.disconnect()
  } catch (error) {
    console.log('Failed to disconnect remote source node', error)
  }
  try {
    nodes.gainNode.disconnect()
  } catch (error) {
    console.log('Failed to disconnect remote gain node', error)
  }
  remoteAudioNodes.delete(track)
}

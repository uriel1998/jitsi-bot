/**
 * Credit: Jimmi Music Bot for Jitsi https://github.com/Music-Bot-for-Jitsi/Jimmi
 */

const recording = document.querySelector('#recording')
const videoboard = document.querySelector('#videoboard')

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

/**
 * Credit: Jimmi Music Bot for Jitsi https://github.com/Music-Bot-for-Jitsi/Jimmi
 */

let initDone = false
let selectedSoundboardMicDeviceId = undefined
const nativeGetUserMedia = navigator.mediaDevices?.getUserMedia
  ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  : undefined

async function promptForSoundboardMicrophoneSelection() {
  if (!nativeGetUserMedia) {
    log('Microphone selection unavailable: getUserMedia is not supported.')
    return false
  }

  let initialStream = undefined
  try {
    initialStream = await nativeGetUserMedia({ audio: true })
  } catch (error) {
    log(`Unable to access microphone: ${error?.message || error}`)
    if (window.self !== window.top) {
      log(
        'This page is running in an iframe. Ensure the iframe includes allow="microphone *".'
      )
    }
    return false
  }

  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'audioinput'
    )
    if (!devices.length) {
      log('No microphone devices found.')
      return false
    }

    const listText = devices
      .map((device, index) => `${index + 1}. ${device.label || `Microphone ${index + 1}`}`)
      .join('\n')
    const userChoice = window.prompt(
      `Select microphone for this soundboard session:\n${listText}\n\nEnter number (default: 1):`,
      '1'
    )

    if (userChoice === null) {
      log('Soundboard start cancelled during microphone selection.')
      return false
    }

    const parsedIndex = Number.parseInt(userChoice, 10)
    const selectedIndex =
      Number.isInteger(parsedIndex) && parsedIndex >= 1 && parsedIndex <= devices.length
        ? parsedIndex - 1
        : 0
    const selectedDevice = devices[selectedIndex]
    selectedSoundboardMicDeviceId = selectedDevice?.deviceId || undefined
    log(`Selected microphone: ${selectedDevice?.label || 'default microphone'}`)
    return true
  } catch (error) {
    log(`Failed during microphone selection: ${error?.message || error}`)
    return false
  } finally {
    for (const track of initialStream.getTracks()) {
      try {
        track.stop()
      } catch (error) {
        console.log('Failed to stop temporary microphone access track', error)
      }
    }
  }
}

function initAudio() {
  log('InitAudio - Using system microphone for bot audio.')
  initDone = true
}

initAudio()

window.promptForSoundboardMicrophoneSelection = promptForSoundboardMicrophoneSelection
window.getSelectedSoundboardMicDeviceId = () => selectedSoundboardMicDeviceId

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

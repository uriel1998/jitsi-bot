// recording support should already be initialized

const suiteConfig = window.chromeTestConfig || {}
const suiteSlug = suiteConfig.slug || 'chrome_probe'
const suiteDisplayName = `🧪 ${suiteSlug}`

JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR)

// Recording bot should not publish any outgoing media.
options.startAudioMuted = 1
options.startWithAudioMuted = true
options.startSilent = Boolean(suiteConfig.startSilent)
options.startVideoMuted = 1
options.startWithVideoMuted = true
options.recordingbotDisplayName = suiteDisplayName
const allowOutgoingMedia = false

JitsiMeetJS.init(options)
const publishedLocalTracks = new WeakSet()

const connectionRetryConfig = {
  intervalMs: 10000,
  maxAttempts: 6,
}
const boshFallbackAttempt = 3
let connectionAttemptCount = 0
let retryTimeoutId = undefined
let waitingForConnectionLogged = false
let usingBoshFallback = false

function getRecordingConferenceState() {
  return {
    suiteSlug,
    connectionAttemptCount,
    waitingForConnectionLogged,
    usingBoshFallback,
    roomJoined: window.roomJoined ?? null,
    connectionEstablished: window.connectionEstablished ?? null,
    roomName,
    targetJitsi: options.targetJitsi?.origin || '',
    serviceUrl: options.serviceUrl || '',
    allowOutgoingMedia,
  }
}

function recordingConferenceLog(message, details = {}) {
  log(message)
  void window.persistRecordingLog?.('info', message, {
    conference: getRecordingConferenceState(),
    ...details,
  })
}

function recordingConferenceWarn(message, details = {}) {
  log(message)
  void window.persistRecordingLog?.('warning', message, {
    conference: getRecordingConferenceState(),
    ...details,
  })
}

const publishLocalTrack = async (track) => {
  if (!allowOutgoingMedia) {
    return
  }
  if (!room || !roomJoined || !track || publishedLocalTracks.has(track)) {
    return
  }
  try {
    if (track.getType() === 'audio' && track.isMuted()) {
      await track.unmute()
    }
    await room.addTrack(track)
    publishedLocalTracks.add(track)
    recordingConferenceLog(`Published local ${track.getType()} track.`, {
      trackType: track.getType?.() || 'unknown',
      muted: track.isMuted?.() ?? null,
    })
  } catch (error) {
    const details = String(error?.message || error?.name || error || 'unknown')
    recordingConferenceWarn(`Failed to publish ${track.getType()} track: ${details}`, {
      error: details,
      trackType: track.getType?.() || 'unknown',
    })
    recordingConferenceWarn(
      'If room AV moderation is enabled, a moderator must allow participant media to publish audio.'
    )
    console.error('Failed to publish local track:', error)
  }
}

/**
 * Handles local tracks.
 * @param tracks Array with JitsiTrack objects
 */
function onLocalTracks({ type, tracks }) {
  if (!allowOutgoingMedia) {
    recordingConferenceLog(`Dropping local ${type} track(s): outgoing media is disabled.`, {
      type,
      trackCount: tracks.length,
    })
    for (let i = 0; i < tracks.length; i++) {
      try {
        tracks[i]?.dispose?.()
      } catch (error) {
        console.error('Failed disposing local track:', error)
      }
    }
    localTracks[type] = []
    return
  }

  localTracks[type] = tracks
  console.log(tracks)
  for (let i = 0; i < localTracks[type].length; i++) {
    localTracks[type][i].addEventListener(
      JitsiMeetJS.events.track.TRACK_MUTE_CHANGED,
      () => {
        console.log(`local ${localTracks[type][i].getType()} track muted`)
      }
    )
    localTracks[type][i].addEventListener(
      JitsiMeetJS.events.track.LOCAL_TRACK_STOPPED,
      () => {
        console.log(
          `local ${localTracks[type][i].getType()} track stopped - disposing...`
        )
        publishedLocalTracks.delete(localTracks[type][i])
        localTracks[type][i].dispose()
      }
    )
    localTracks[type][i].addEventListener(
      JitsiMeetJS.events.track.TRACK_AUDIO_OUTPUT_CHANGED,
      (deviceId) =>
        console.log(`track audio output device was changed to ${deviceId}`)
    )
    if (roomJoined) {
      publishLocalTrack(localTracks[type][i])
    }
  }
}

/**
 * Handles remote tracks
 * @param track JitsiTrack object
 */
function onRemoteTrack(track) {
  if (!track || track.isLocal?.()) {
    return
  }

  const participantId = track.getParticipantId?.()
  if (!remoteTracks[participantId]) {
    remoteTracks[participantId] = []
  }
  remoteTracks[participantId].push(track)

  if (track.getType() === 'audio') {
    window.registerRemoteAudioTrackForRecording?.(track)
    recordingConferenceLog(
      `Remote audio track added from ${participantId || 'unknown participant'}.`,
      {
        participantId: participantId || '',
        trackType: track.getType?.() || '',
      }
    )
  } else {
    recordingConferenceLog('Non-audio remote track added.', {
      participantId: participantId || '',
      trackType: track.getType?.() || '',
    })
  }
}

/* -------------------------
 * Command Handler Functions
 * -------------------------
 */

const reloadBot = (userId) => {
  // FIXME Needs fix for node ?
  recordingConferenceWarn('Reload bot command invoked', { userId: userId || '' })
  room.sendMessage('Reloading Bot, see ya in a second. ')
  location.reload()
}

const unknownCommand = (userId) => {
  room.sendMessage('Command not found', userId)
}

const quit = (userId) => {
  recordingConferenceWarn('Quit command invoked', { userId: userId || '' })
  room.sendMessage(`Recording bot leaving.`)
  room.room.doLeave()
  window.close()
}

const stopRecording = async (userId) => {
  const sender = room.getParticipantById(userId)
  if (!sender?.isModerator?.()) {
    room.sendMessage(
      'Only moderators can stop the recording with /stop.',
      userId
    )
    return
  }

  try {
    await window.stopAutomatedRecordingFlow?.()
    recordingConferenceWarn('Stop recording command completed', { userId })
    room.sendMessage('Recording stopped.', userId)
    disconnectBotFromConference()
  } catch (error) {
    room.sendMessage('Failed to stop recording.', userId)
    recordingConferenceWarn('Failed to stop automated recording flow', {
      userId,
      error: error?.message || String(error),
    })
    console.error('Failed to stop automated recording flow:', error)
  }
}

const disconnectBotFromConference = () => {
  try {
    recordingConferenceWarn('Disconnecting recording bot from conference.')
    room?.room?.doLeave()
  } catch (error) {
    recordingConferenceWarn('Error while leaving conference room', {
      error: error?.message || String(error),
    })
    console.error('Error while leaving conference room:', error)
  }
  try {
    con?.disconnect()
  } catch (error) {
    recordingConferenceWarn('Error while disconnecting conference connection', {
      error: error?.message || String(error),
    })
    console.error('Error while disconnecting conference connection:', error)
  }
}

const stopRecordingFromUi = async () => {
  try {
    await window.stopAutomatedRecordingFlow?.()
    recordingConferenceWarn('Stop probe requested from UI.')
    room?.sendMessage(`Probe stopped from ${suiteSlug}.`)
    document.querySelector('#start_recording_button')?.removeAttribute('disabled')
    document.querySelector('#connectionStatus') &&
      (document.querySelector('#connectionStatus').textContent = 'disconnecting')
    disconnectBotFromConference()
  } catch (error) {
    log(`Failed to stop recording from UI: ${error?.message || error}`)
    console.error('Failed to stop automated recording flow from UI:', error)
  }
}

const startRecordingFromUi = async () => {
  if (!roomJoined) {
    recordingConferenceWarn('Cannot start recording yet: conference is not joined.')
    return
  }
  try {
    const started = await window.startAutomatedRecordingFlow?.()
    if (started) {
      recordingConferenceLog('Probe started from UI.')
      room?.sendMessage(`Probe started from ${suiteSlug}.`)
      document
        .querySelector('#start_recording_button')
        ?.setAttribute('disabled', 'disabled')
    }
  } catch (error) {
    log(`Failed to start recording from UI: ${error?.message || error}`)
    console.error('Failed to start automated recording flow from UI:', error)
  }
}

const help = (userId) => {
  const commands = [
    'Available Commands:',
    '/help',
    '/reload',
    '/stop # moderator only',
    '/quit',
  ]

  room.sendMessage(commands.join('\n'), userId)
}

/* -----------------------------
 * Command Handler Functions End
 * -----------------------------
 */

const commandHandler = {
  '/help': help,
  '/reload': reloadBot,
  '/stop': stopRecording,
  '/quit': quit,
}

function conferenceInit() {
  function scheduleReconnect(reason) {
    if (connectionAttemptCount >= connectionRetryConfig.maxAttempts) {
      log(
        `Connection retry limit reached (${connectionRetryConfig.maxAttempts}). Giving up.`
      )
      return
    }

    connectionAttemptCount += 1
    const attemptLabel = `${connectionAttemptCount}/${connectionRetryConfig.maxAttempts}`
    log(
        `Connection failed (${reason}). Retrying in ${
          connectionRetryConfig.intervalMs / 1000
        }s (${attemptLabel})...`
      )
      window.recordingWarningLog?.('Scheduling recording reconnect', {
        reason,
        attemptLabel,
        conference: getRecordingConferenceState(),
      })

    if (retryTimeoutId) {
      clearTimeout(retryTimeoutId)
    }
    retryTimeoutId = setTimeout(() => {
      startConnection(`retry ${attemptLabel}`)
    }, connectionRetryConfig.intervalMs)
  }

  function startConnection(reason) {
    if (con) {
      try {
        con.disconnect()
      } catch (error) {
        console.log('Error while disconnecting previous connection', error)
      }
    }

    if (!usingBoshFallback && connectionAttemptCount >= boshFallbackAttempt) {
      const fallbackBosh =
        options.bosh ||
        (options.targetJitsi?.origin
          ? `${options.targetJitsi.origin}/http-bind`
          : undefined)
      if (fallbackBosh) {
        options.serviceUrl = fallbackBosh
        usingBoshFallback = true
        recordingConferenceWarn(`Switching to BOSH: ${fallbackBosh}`, {
          fallbackBosh,
        })
      } else {
        recordingConferenceWarn('BOSH fallback requested but no endpoint is available.')
      }
    }

    connectionEstablished = false
    document.querySelector('#connectionStatus') &&
      (document.querySelector('#connectionStatus').textContent = 'connecting')
    window.setTargetJitsiConnectedUi?.(false)
    recordingConferenceLog(
      reason ? `Connecting to Jitsi (${reason})...` : 'Connecting to Jitsi...'
    )

    con = new JitsiMeetJS.JitsiConnection(null, null, options)

    const onConnectionSuccess = (ev) => {
      console.log('Connection Success')
      recordingConferenceLog('Connection established.')
      connectionEstablished = true
      document.querySelector('#connectionStatus') &&
        (document.querySelector('#connectionStatus').textContent = 'connected')
      waitingForConnectionLogged = false
      connectionAttemptCount = 0
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId)
        retryTimeoutId = undefined
      }
    }
    const onConnectionFailed = (ev) => {
      console.log('Connection Failed')
      recordingConferenceWarn('Connection failed.', {
        error: ev?.message || ev?.type || 'unknown',
      })
      document.querySelector('#connectionStatus') &&
        (document.querySelector('#connectionStatus').textContent = 'failed')
      window.setTargetJitsiConnectedUi?.(false)
      scheduleReconnect('failed')
    }

    /**
     * This function is called when we disconnect.
     */
    function disconnect() {
      console.log('disconnect!')
      recordingConferenceWarn('Connection disconnected.', {
        conference: getRecordingConferenceState(),
      })
      document.querySelector('#connectionStatus') &&
        (document.querySelector('#connectionStatus').textContent = 'disconnected')
      window.setTargetJitsiConnectedUi?.(false)
      con.removeEventListener(
        JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
        onConnectionSuccess
      )
      con.removeEventListener(
        JitsiMeetJS.events.connection.CONNECTION_FAILED,
        onConnectionFailed
      )
      con.removeEventListener(
        JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
        disconnect
      )
      scheduleReconnect('disconnected')
    }

    con.addEventListener(
      JitsiMeetJS.events.connection.CONNECTION_ESTABLISHED,
      onConnectionSuccess
    )
    con.addEventListener(
      JitsiMeetJS.events.connection.CONNECTION_FAILED,
      onConnectionFailed
    )
    con.addEventListener(
      JitsiMeetJS.events.connection.CONNECTION_DISCONNECTED,
      disconnect
    )

    con.connect()
  }

  startConnection()
}

const getNameById = (userId) => {
  return room.getParticipantById(userId)?._displayName
}

const getStatsIDById = (userId) => {
  return room.getParticipantById(userId)?._statsID
}

function roomInit() {
  if (!connectionEstablished) {
    if (!waitingForConnectionLogged) {
      recordingConferenceLog('Waiting for connection to establish...')
      waitingForConnectionLogged = true
    }
    setTimeout(roomInit, 1000)
    return
  }

  const onConferenceJoined = (ev) => {
    console.log('Conference Joined')
    recordingConferenceLog('Conference joined.')
    document.querySelector('#connectionStatus') &&
      (document.querySelector('#connectionStatus').textContent = 'joined')

    bot_started = true
    roomJoined = true
    window.setTargetJitsiConnectedUi?.(true)

    document.querySelector('#start_recording_button')?.removeAttribute('disabled')

    Object.values(localTracks).forEach((tracks) => {
      tracks.forEach((track) => publishLocalTrack(track))
    })
  }

  room = con.initJitsiConference(roomName, options)

  room.addEventListener(
    JitsiMeetJS.events.conference.CONFERENCE_JOINED,
    onConferenceJoined
  )

  room.on(JitsiMeetJS.events.conference.CONFERENCE_LEFT, () => {
    roomJoined = false
    document.querySelector('#connectionStatus') &&
      (document.querySelector('#connectionStatus').textContent = 'left')
    window.setTargetJitsiConnectedUi?.(false)
    recordingConferenceWarn('Conference left.')
    document
      .querySelector('#start_recording_button')
      ?.setAttribute('disabled', 'disabled')
  })

  room.on(JitsiMeetJS.events.conference.MESSAGE_RECEIVED, (userId, message) => {
    if (!roomJoined || !bot_started) {
      return
    }

    log(
      'Message received: \n' +
        (getNameById(userId) || getStatsIDById(userId) || userId) +
        ': ' +
        message,
      LOGCLASSES.PUBLIC_MESSAGE
    )
  })
  room.on(
    JitsiMeetJS.events.conference.PRIVATE_MESSAGE_RECEIVED,
    (userId, message) => {
      if (!roomJoined || !bot_started) {
        return
      }

      log(
        'Private Message recieved: \n' +
          (getNameById(userId) || getStatsIDById(userId) || userId) +
          ': ' +
          message,
        LOGCLASSES.PRIVATE_MESSAGE
      )

      const firstSpaceIndex = message.indexOf(' ')
      function getCommand() {
        if (firstSpaceIndex !== -1) {
          return message.substring(0, firstSpaceIndex) // before first space is command
        } else {
          return message
        }
      }
      function getArgument() {
        if (firstSpaceIndex !== -1) {
          return message.substring(firstSpaceIndex + 1) // after first space is arguments
        } else return undefined
      }
      const command = getCommand()
      const argument = getArgument()

      console.log(command, argument)

      try {
        commandHandler[command](userId, argument) // Executing corresponding function in commandHandler List.
      } catch (error) {
        if (message.startsWith('/')) {
          if (command in commandHandler) {
            room.sendMessage('Error while Executing Command.', userId)
          } else {
            room.sendMessage('Command not found. Try /help', userId)
          }
        } else {
          room.sendMessage(
            'I wont talk back, try commands with / like /help.',
            userId
          )
        }
        console.error(error)
      }
    }
  )
  // onJoin
  room.on(JitsiMeetJS.events.conference.USER_JOINED, (userId, userObj) => {
    printParticipants()
    recordingConferenceLog('USER JOINED EVENT ' + userId + ': ' + userObj._displayName, {
      participantId: userId,
      displayName: userObj?._displayName || '',
    })
  })

  room.on(JitsiMeetJS.events.conference.USER_LEFT, (userId, userObj) => {
    recordingConferenceWarn('USER LEFT EVENT ' + userId + ': ' + userObj._displayName, {
      participantId: userId,
      displayName: userObj?._displayName || '',
    })
    printParticipants()
    const tracks = remoteTracks[userId]
    if (!tracks?.length) {
      return
    }

    for (let i = 0; i < tracks.length; i++) {
      if (tracks[i].getType?.() === 'audio') {
        window.unregisterRemoteAudioTrackForRecording?.(tracks[i])
      }
    }
    delete remoteTracks[userId]
  })

  room.on(JitsiMeetJS.events.conference.TRACK_ADDED, onRemoteTrack)
  room.on(JitsiMeetJS.events.conference.TRACK_REMOVED, (track) => {
    if (!track || track.isLocal?.()) {
      return
    }
    recordingConferenceWarn('Remote track removed', {
      participantId: track.getParticipantId?.() || '',
      trackType: track.getType?.() || '',
    })
    if (track.getType?.() === 'audio') {
      window.unregisterRemoteAudioTrackForRecording?.(track)
    }
    const participantId = track.getParticipantId?.()
    if (remoteTracks[participantId]) {
      remoteTracks[participantId] = remoteTracks[participantId].filter(
        (remoteTrack) => remoteTrack !== track
      )
      if (remoteTracks[participantId].length === 0) {
        delete remoteTracks[participantId]
      }
    }
    console.log(`track removed!!!${track}`)
  })

  room.on(JitsiMeetJS.events.conference.USER_ROLE_CHANGED, (userId, role) => {
    console.log(userId, ' Role Change: ', role)
    printParticipants()
    if (userId === room.myUserId()) {
      Object.values(localTracks).forEach((tracks) => {
        tracks.forEach((track) => publishLocalTrack(track))
      })
    }
  })

  room.on(
    JitsiMeetJS.events.conference.PARTICIPANT_PROPERTY_CHANGED,
    (userObj, propertyKey, oldValue, newValue) => {
      console.log(
        'PARTICIPANT PROPERTY CHANGE EVENT: \n',
        userObj._displayName,
        '\n',
        propertyKey,
        ': ',
        oldValue,
        ' --> ',
        newValue
      )
    }
  )

  room.on(
    JitsiMeetJS.events.conference.USER_STATUS_CHANGED,
    (userId, newStatus) => {
      console.log('USER STATUS CHANGE EVENT \n', userId, ': ', newStatus)
    }
  )

  room.on(JitsiMeetJS.events.conference.TRACK_MUTE_CHANGED, (track) => {
    console.log(`${track}: ${track.getType()} - set to ${track.isMuted()}`)
  })
  room.on(
    JitsiMeetJS.events.conference.DISPLAY_NAME_CHANGED,
    (userID, displayName) => console.log(`${userID} - ${displayName}`)
  )
  room.on(JitsiMeetJS.events.conference.PHONE_NUMBER_CHANGED, () =>
    console.log(`${room.getPhoneNumber()} - ${room.getPhonePin()}`)
  )

  room.on(
    JitsiMeetJS.events.conference._MEDIA_SESSION_ACTIVE_CHANGED,
    (jingle_session) => {
      if (jingle_session.peerconnection.localTracks.size === 0) {
        // add local track to peerconnection as its not being added yet.
        console.log('Adding local tracks to peerconnection. #jvbFix')
        Object.values(localTracks).forEach((tracks) => {
          tracks.forEach((track) => publishLocalTrack(track))
        })
      }
    }
  )

  room.on(JitsiMeetJS.events.conference.KICKED, (kickedByUser, message) => {
    recordingConferenceWarn(
      `\tI got kicked by ${kickedByUser._displayName}. \n\tReason: ${message}`,
      {
        kickedBy: kickedByUser?._displayName || '',
        message,
      }
    )
  })

  room.setDisplayName(options.recordingbotDisplayName)

  room.join()
}

function main() {
  if (bot_started) {
    return
  }

  document.title = `${suiteSlug} - ${roomName}`

  conferenceInit()

  recordingConferenceLog('Target: ' + roomName, { roomName })
  roomInit()
}

document.querySelector('#start_bot_button')?.addEventListener('click', openBot)
document
  .querySelector('#stop_bot_button')
  ?.addEventListener('click', stopRecordingFromUi)
document
  .querySelector('#start_recording_button')
  ?.addEventListener('click', startRecordingFromUi)
document
  .querySelector('#clearLog')
  ?.addEventListener(
    'click',
    () => (document.querySelector('#log').textContent = '')
  )

main()

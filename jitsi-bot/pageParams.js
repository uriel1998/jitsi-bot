const checkRoomParam = (urlParams) => {
  // get page Parameter room

  const targetJitsi = urlParams.get('targetJitsi') || undefined

  if (!targetJitsi) {
    log('No targetJitsi Parameter, not launching bot.')
    return false
  }
  try {
    console.log('targetJitsi:', targetJitsi)
    const targetJitsiUrl = new URL(targetJitsi)
    console.log('targetJitsiUrl:', targetJitsiUrl)

    // pathname includes the first /
    const targetRoom = targetJitsiUrl.pathname.split('/')[1] || undefined

    if (!targetRoom) {
      log('No room Parameter in targetJitsi URL, not launching bot.')
      return false
    }
    roomName = targetRoom.replace(' ', '').toLowerCase()
  } catch (error) {
    log('Invalid targetJitsi URL.', LOGCLASSES.BOT_INTERNAL_LOG)
    return false
  }

  return true
}

const checkUrlParams = () => {
  const urlParams = new URLSearchParams(window.location.search)

  if (!checkRoomParam(urlParams)) {
    return false
  }

  return true
}

const mountConfInit = () => {
  if (!window.JitsiMeetJS) {
    setTimeout(mountConfInit, 1000)
    return
  }
  log('JitsiMeetJS loaded')
  document.querySelector('#confInit').src = 'conferenceInit.js'
}

const toAbsoluteUrl = (value, baseUrl) => {
  if (!value) {
    return undefined
  }
  try {
    return new URL(value, baseUrl).toString()
  } catch (error) {
    return undefined
  }
}

const parseScalarValue = (rawValue) => {
  if (rawValue === 'true') {
    return true
  }
  if (rawValue === 'false') {
    return false
  }
  if (rawValue === 'null') {
    return null
  }
  if (rawValue !== '' && !Number.isNaN(Number(rawValue))) {
    return Number(rawValue)
  }
  return rawValue
}

const assignPath = (obj, path, value) => {
  const keys = path.split('.').filter(Boolean)
  if (keys.length === 0) {
    return
  }

  let current = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (
      typeof current[key] !== 'object' ||
      current[key] === null ||
      Array.isArray(current[key])
    ) {
      current[key] = {}
    }
    current = current[key]
  }
  current[keys[keys.length - 1]] = value
}

const parseTargetOverridesFromHash = (hashValue) => {
  if (!hashValue || hashValue.length <= 1) {
    return {}
  }

  const overrides = {}
  const rawHash = hashValue.startsWith('#') ? hashValue.slice(1) : hashValue
  const hashParams = new URLSearchParams(rawHash)

  for (const [rawKey, rawValue] of hashParams.entries()) {
    const normalizedKey = rawKey.startsWith('config.')
      ? rawKey.slice('config.'.length)
      : rawKey
    assignPath(overrides, normalizedKey, parseScalarValue(rawValue))
  }

  return overrides
}

const mergeConfig = () => {
  if (checkUrlParams()) {
    if (!window.config) {
      setTimeout(mergeConfig, 1000)
      return
    }

    // merge global config object with options
    options = {
      ...config,
      ...options,
    }

    const targetOrigin = options.targetJitsi?.origin
    const targetHost = options.targetJitsi?.hostname
    if (!targetOrigin || !targetHost) {
      log('Invalid targetJitsi URL.', LOGCLASSES.BOT_INTERNAL_LOG)
      return
    }

    if (!options.serviceUrl) {
      // Prefer websocket when available, then fallback to bosh.
      options.serviceUrl =
        toAbsoluteUrl(options.websocket, targetOrigin) ||
        toAbsoluteUrl(options.bosh, targetOrigin) ||
        `https://${targetHost}/http-bind`
    }

    options.hosts = {
      ...(options.hosts || {}),
      domain: options.hosts?.domain || targetHost,
      muc: options.hosts?.muc || `conference.${targetHost}`,
    }
    log('Using serviceUrl: ' + options.serviceUrl)

    // mount libJitsiMeet
    log('Mounting libJitsiMeet from ' + libJitsiMeetSrc)
    document.querySelector('#libJitsiMeet').src = libJitsiMeetSrc

    // mount conferenceInit
    mountConfInit()
  }
}

const initConfigAndLib = () => {
  const url = new URL(window.location.href)

  if (url.searchParams.has('targetJitsi')) {
    try {
      const targetJitsi = new URL(url.searchParams.get('targetJitsi'))
      if (targetJitsi) {
        // add domain to options
        options.targetJitsi = targetJitsi
        const targetJitsiConfig = `https://${targetJitsi.hostname}/config.js`
        
        document.querySelector(
          '#jitsiConfig'
        ).src = targetJitsiConfig
        log('Mounting config from ' + targetJitsiConfig)
        libJitsiMeetSrc = `https://${targetJitsi.hostname}/libs/lib-jitsi-meet.min.js`

        const targetOverrides = parseTargetOverridesFromHash(targetJitsi.hash)
        options = {
          ...options,
          ...targetOverrides,
        }
        if (Object.keys(targetOverrides).length > 0) {
          log('Applied targetJitsi hash overrides.')
        }
      } else {
        log('No targetJitsi URL provided')
        return
      }
    } catch (error) {
      console.error('Error parsing targetJitsi URL:', error)
      log('Invalid targetJitsi URL.', LOGCLASSES.BOT_INTERNAL_LOG)
      return
    }
    mergeConfig()
  }
  else {
    log('No targetJitsi URL provided. Please enter a conference room (including domain) in the corresponding field.')
    return
  }
}

initConfigAndLib()

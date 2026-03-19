function isChromiumRecordingBrowser() {
  const userAgent = navigator.userAgent || ''
  const brands = navigator.userAgentData?.brands || []

  const isFirefoxFamily = /Firefox|FxiOS/i.test(userAgent)
  if (isFirefoxFamily) {
    return false
  }

  if (brands.length > 0) {
    return brands.some((brandEntry) =>
      /Chromium|Chrome|Microsoft Edge|Opera|Brave/i.test(brandEntry.brand || '')
    )
  }

  return /Chrome|Chromium|CriOS|Edg|OPR/i.test(userAgent)
}

function getChromeRecordingPageUrl() {
  return new URL('recording_chrome.html', window.location.href).toString()
}

function redirectToChromeRecordingVariant() {
  if (!isChromiumRecordingBrowser()) {
    return false
  }

  const chromeVariantUrl = getChromeRecordingPageUrl()
  if (window.location.href !== chromeVariantUrl) {
    window.location.replace(chromeVariantUrl)
    return true
  }

  return false
}

window.isChromiumRecordingBrowser = isChromiumRecordingBrowser
window.getChromeRecordingPageUrl = getChromeRecordingPageUrl
window.redirectToChromeRecordingVariant = redirectToChromeRecordingVariant

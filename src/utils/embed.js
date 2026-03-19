function toBase64Url(binaryString) {
  return btoa(binaryString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(base64Url) {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/')
  const neededPadding = padded.length % 4
  const withPadding = neededPadding ? padded + '='.repeat(4 - neededPadding) : padded
  return atob(withPadding)
}

export function encodeEmbedConfig(config) {
  const json = JSON.stringify(config)
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  bytes.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return toBase64Url(binary)
}

export function decodeEmbedConfig(payload) {
  if (!payload) return null
  try {
    const binary = fromBase64Url(payload)
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    return JSON.parse(json)
  } catch {
    return null
  }
}

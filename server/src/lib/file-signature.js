/**
 * 文件内容签名识别。
 *
 * 背景：上传接口原先只检查「MIME 或扩展名」，改个扩展名就能把任意内容送进 COS。
 * 这里按文件头字节判断真实类型，路由据此拒绝伪装文件。
 * 只做容器级识别（不解码、不验时长），目的是拦住明显的伪装，不是完整的安全扫描。
 */

function ascii(buffer, start, end) {
  if (!buffer || buffer.length < end) return ''
  return buffer.toString('ascii', start, end)
}

/** 识别音频容器：返回 mp3 / m4a / aac / wav / ogg，无法识别返回 null */
function detectAudioType(buffer) {
  if (!buffer || buffer.length < 4) return null

  // MP3：ID3 标签 或 帧同步头 FF Ex
  if (ascii(buffer, 0, 3) === 'ID3') return 'mp3'
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3'

  // M4A / MP4：第 4 字节起是 ftyp box
  if (buffer.length >= 12 && ascii(buffer, 4, 8) === 'ftyp') return 'm4a'

  // WAV：RIFF....WAVE
  if (buffer.length >= 12 && ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WAVE') {
    return 'wav'
  }

  // OGG：OggS
  if (ascii(buffer, 0, 4) === 'OggS') return 'ogg'

  // ADTS AAC：FF F1 / FF F9
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) return 'aac'

  return null
}

/** 识别图片容器：返回 jpg / png / webp，无法识别返回 null */
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null

  // JPEG：FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'

  // PNG：89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png'
  }

  // WebP：RIFF....WEBP
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') return 'webp'

  return null
}

/**
 * 校验上传文件的真实内容类型。
 * @param buffer 文件内容
 * @param detected detectAudioType / detectImageType 的结果
 * @param allowed 允许的扩展名集合（如 ['mp3','m4a']）
 * @returns { ok: boolean, detected: string|null, reason: string }
 */
function verifyContent(buffer, detected, allowed) {
  if (!detected) {
    return { ok: false, detected: null, reason: '文件内容不是可识别的音频/图片格式' }
  }
  if (allowed && allowed.indexOf(detected) < 0) {
    return {
      ok: false,
      detected,
      reason: '文件实际内容是 ' + detected + '，与允许的格式不符'
    }
  }
  return { ok: true, detected, reason: '' }
}

module.exports = { detectAudioType, detectImageType, verifyContent }

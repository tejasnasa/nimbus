/**
 * @module agent/audio/wav
 * @description Wraps raw 16-bit PCM in a RIFF/WAVE container, which is what a
 * transcription endpoint expects to receive as an uploaded file.
 *
 * @important Samples are written little-endian regardless of the host's byte
 *            order, and the header is the plain 44-byte PCM form, with no extra
 *            chunks, because some providers reject anything fancier.
 */

/** Size of the canonical PCM WAV header, in bytes. */
export const WAV_HEADER_BYTES = 44;

/**
 * Encodes mono or multi-channel 16-bit PCM as a WAV file.
 *
 * @param pcm - Interleaved signed 16-bit samples.
 * @param sampleRate - Samples per second per channel.
 * @param channels - Channel count; defaults to mono.
 * @returns The complete file: header followed by the samples.
 */
export function encodeWav(
  pcm: Int16Array,
  sampleRate: number,
  channels = 1,
): Uint8Array {
  const dataBytes = pcm.length * 2;
  const out = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true); // byte rate
  view.setUint16(32, channels * 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) {
    view.setInt16(WAV_HEADER_BYTES + i * 2, pcm[i] ?? 0, true);
  }
  return out;
}

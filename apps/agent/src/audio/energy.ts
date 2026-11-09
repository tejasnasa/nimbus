/**
 * @module agent/audio/energy
 * @description Loudness of a clip, used to tell real speech from the text a
 * transcription model invents when it is handed near-silence.
 */

/**
 * Root-mean-square level of 16-bit PCM, scaled to the range 0 to 1.
 *
 * @param pcm - Signed 16-bit samples.
 * @returns 0 for an empty or silent clip, up to 1 for full scale.
 */
export function rmsEnergy(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const sample = (pcm[i] ?? 0) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / pcm.length);
}

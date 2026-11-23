/**
 * @module web/src/timers/sound
 * The sound and buzz of a finished timer.
 *
 * The chime is made with the Web Audio API rather than an audio file, so
 * there's nothing extra to download or cache. Browsers only let a page make
 * sound after a tap, so `unlockAudio()` runs on the taps that start a timer
 * or test the sound, and the chime can then play when a timer ends.
 */

let context: AudioContext | null = null;

/** Create or wake the audio context. Call it from a tap or click. */
export function unlockAudio(): void {
    try {
        context ??= new AudioContext();
        if (context.state === 'suspended') void context.resume();
    } catch {
        // No Web Audio: timers still vibrate and show
    }
}

/** Three rising notes, about a second in all. */
export function playChime(): void {
    unlockAudio();
    if (!context) return;
    const start = context.currentTime;
    [880, 1109, 1319].forEach((frequency, index) => {
        const at = start + index * 0.28;
        const oscillator = context!.createOscillator();
        const gain = context!.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);
        oscillator.connect(gain).connect(context!.destination);
        oscillator.start(at);
        oscillator.stop(at + 0.3);
    });
}

/** Buzz, where the device can (Android; not desktops or iPhones). */
export function vibrate(): void {
    try {
        navigator.vibrate?.([300, 150, 300]);
    } catch {
        // Not allowed: the chip and the sound still show it
    }
}

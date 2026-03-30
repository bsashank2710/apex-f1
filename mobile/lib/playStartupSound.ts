/**
 * F1 radio-style startup sting — plays once per cold start (retries after user tap on web if autoplay is blocked).
 */
import { Audio } from 'expo-av';

let playedSuccessfully = false;

export async function playStartupSound(): Promise<void> {
  if (playedSuccessfully) return;
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      playThroughEarpieceAndroid: false,
    });
    const { sound } = await Audio.Sound.createAsync(
      require('../assets/sounds/startup.mp3'),
      { shouldPlay: true, volume: 1 },
    );
    playedSuccessfully = true;
    sound.setOnPlaybackStatusUpdate((status) => {
      if (status.isLoaded && status.didJustFinish) {
        void sound.unloadAsync();
      }
    });
  } catch (e) {
    console.warn('[APEX] Startup sound:', e);
  }
}

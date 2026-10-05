// Efeitos sonoros do Jonjo. Os arquivos vivem em public/audios e são servidos
// na raiz (dev pelo Vite, produção pelo express que serve o dist).
export type SoundName =
  | 'notifica_entrada'
  | 'welcome'
  | 'fun'
  | 'compartilhando_tela'
  | 'fullscreen';

const SOUND_SRC: Record<SoundName, string> = {
  notifica_entrada: `${import.meta.env.BASE_URL}audios/notifica_entrada.ogg`,
  welcome: `${import.meta.env.BASE_URL}audios/welcome.ogg`,
  fun: `${import.meta.env.BASE_URL}audios/fun.ogg`,
  compartilhando_tela: `${import.meta.env.BASE_URL}audios/compartilhando_tela.ogg`,
  fullscreen: `${import.meta.env.BASE_URL}audios/compartilhando_tela2-fullscreem.ogg`,
};

// Guardamos um elemento base por som para reaproveitar o download. Cada disparo
// clona o elemento, permitindo que dois sons se sobreponham sem se cortarem.
const cache = new Map<SoundName, HTMLAudioElement>();

function baseAudio(name: SoundName): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  let audio = cache.get(name);
  if (!audio) {
    audio = new Audio(SOUND_SRC[name]);
    audio.preload = 'auto';
    cache.set(name, audio);
  }
  return audio;
}

export function preloadSounds() {
  (Object.keys(SOUND_SRC) as SoundName[]).forEach(baseAudio);
}

export function playSound(name: SoundName) {
  try {
    const base = baseAudio(name);
    if (!base) return;
    const audio = base.cloneNode(true) as HTMLAudioElement;
    audio.volume = 0.7;
    // O navegador pode recusar o play sem gesto do usuário; ignoramos em silêncio.
    void audio.play().catch(() => undefined);
  } catch {
    // Nunca deixamos um som quebrar a experiência.
  }
}

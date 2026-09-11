/** Znaki interpunkcyjne, które syntezator czytałby jako pauzę albo literował. */
const STRIP = /[¿?¡!]/g;

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Czyta tekst po hiszpańsku. Wolniej niż normalnie — to materiał do nauki. */
export function say(text: string, rate = 0.85): void {
  if (!canSpeak()) return;
  const utterance = new SpeechSynthesisUtterance(text.replace(STRIP, ''));
  utterance.lang = 'es-ES';
  utterance.rate = rate;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

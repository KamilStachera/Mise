// Generated from Palabras.dc.html (repo E:/Repos/Palabras, `npm run gen:data`) and copied here. Do not edit by hand.
import type { Deck } from '../types';

export const DECKS: Deck[] = [
  { id: "podstawy", name: "Podstawy", sub: "Powitania, zwroty grzecznościowe" },
  { id: "jedzenie", name: "Jedzenie i picie", sub: "Bar, restauracja, sklep" },
  { id: "miasto", name: "Miasto i podróż", sub: "Dworzec, kierunki, bilety" },
  { id: "codzienne", name: "Codzienne słowa", sub: "Czasowniki i rzeczy wokół" },
  { id: "moje", name: "Moje słowa", sub: "Dodane przez Ciebie" },
];

export const DECK_NAMES: Record<string, string> = Object.fromEntries(
  DECKS.map((d) => [d.id, d.name]),
);

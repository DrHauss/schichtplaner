// Zerlegt eine Hex-Farbe (3- oder 6-stellig, mit oder ohne '#') in RGB-Komponenten. Liefert null
// bei ungueltiger Eingabe, statt eine Fallback-Farbe zu erraten -- Aufrufer entscheiden selbst,
// was in diesem Fall dargestellt werden soll.
export function hexZuRgb(hexFarbe: string | undefined | null): [number, number, number] | null {
  if (!hexFarbe) return null;
  const hex = hexFarbe.replace("#", "");
  const voll = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (voll.length !== 6) return null;
  const r = parseInt(voll.slice(0, 2), 16);
  const g = parseInt(voll.slice(2, 4), 16);
  const b = parseInt(voll.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return [r, g, b];
}

// Waehlt Schwarz/Weiss als Textfarbe je nach wahrgenommener Helligkeit des Hintergrunds (YIQ-
// Naeherung), damit z. B. helle Schichtarten-Farben (Gelb, Hellgruen) nicht mit weissem Text auf
// weiss aehnlichem Grund unleserlich werden.
export function kontrastfarbe(hexFarbe: string | undefined | null): string {
  const rgb = hexZuRgb(hexFarbe);
  if (!rgb) return "#ffffff";
  const [r, g, b] = rgb;
  const wahrgenommeneHelligkeit = (r * 299 + g * 587 + b * 114) / 1000;
  return wahrgenommeneHelligkeit >= 150 ? "#15325f" : "#ffffff";
}

import { MITEL_FARBEN } from "../lib/farbe";

// Schnellauswahl der Mitel-Markenfarben neben dem nativen <input type="color"> -- der native
// Picker deckt zwar jede beliebige Farbe ab, macht die markenkonformen Farben aber nicht
// erkennbar/erreichbar. Ein Klick uebernimmt die jeweilige Farbe direkt in den Picker-Wert.
export default function MitelFarbauswahl({ wert, onWahl }: { wert: string; onWahl: (hex: string) => void }) {
  return (
    <div style={{ display: "flex", gap: "0.2rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
      {MITEL_FARBEN.map((f) => (
        <button
          key={f.hex}
          type="button"
          title={f.name}
          onClick={() => onWahl(f.hex)}
          style={{
            width: "1.1rem",
            height: "1.1rem",
            padding: 0,
            borderRadius: "3px",
            background: f.hex,
            cursor: "pointer",
            border: wert.toLowerCase() === f.hex ? "2px solid #15325f" : "1px solid rgba(0,0,0,0.15)",
          }}
        />
      ))}
    </div>
  );
}

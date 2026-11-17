// perillasDictionary.ts
// Traductor de perillas literarias -> caption (style_tags) + esqueleto de letra para ACE-Step 1.5
// OJO: los tags son hipótesis de trabajo. Valida con A/B (misma seed, cambia un solo tag) y ajusta pesos.

export type Lang = "es" | "en";
export type Estilo =
  | "confesional" | "epico" | "poetico" | "conversacional" | "cinematografico" | "urbano";

export interface Perillas {
  intensidad: number;   // 0-100 Intensidad Creativa
  profundidad: number;  // 0-100 Profundidad Emocional
  experimental: number; // 0-100 Nivel Experimental
  estilo: Estilo;       // Estilo Narrativo
  imperfeccion: number; // 0-100 Imperfección Humana / Quinto Acorde
  lang: Lang;
  duracionSeg?: number; // default 180
  instrumentacion?: ModoInstr;          // "auto" (default) | "acustico" | "hibrido"
  pedido?: string;                      // texto libre del usuario: aquí se detectan sintes, pads, urbano, etc.
  componentes?: ComponenteHibrido[];    // forzar componentes híbridos explícitos
}

type Banda = "bajo" | "medio" | "alto" | "max";
const banda = (v: number): Banda => (v < 25 ? "bajo" : v < 55 ? "medio" : v < 80 ? "alto" : "max");

// ================= IDENTIDAD SONORA nov4-ix: DOS CAPAS =================
// Capa 1 (voz): SIEMPRE humana y natural. Innegociable.
// Capa 2 (instrumentación): híbrida y flexible. Sintes, pads y urbano SÍ entran, siempre con textura analógica cálida.

// ---------- 1A. CAPA DE VOZ (siempre activa, va primero: los primeros tags pesan más) ----------
export const CAPA_VOZ = [
  "close-mic natural vocal", "natural human vocals", "audible breaths", "warm human timbre", "expressive phrasing",
];

// Ambiente base: agnóstico a la instrumentación para no chocar con sintes ni urbano.
export const BASE_AMBIENTE = ["organic", "warm analog tape", "live room feel", "intimate"];

// ---------- 1B. CAPA DE INSTRUMENTACIÓN HÍBRIDA ----------
export type ModoInstr = "auto" | "acustico" | "hibrido";
export type ComponenteHibrido = "pads" | "guitarra" | "bateria" | "bajo" | "textura";

// Si no hay nada híbrido pedido ni sugerido por el estilo, base acústica.
export const ACUSTICO_DEFAULT = ["acoustic instruments", "real drums"];

export const HIBRIDO: Record<ComponenteHibrido, string[]> = {
  pads:     ["warm analog synth pads"],
  guitarra: ["saturated tube electric guitar"],
  bateria:  ["punchy acoustic-urban drums"],
  bajo:     ["deep sub-bass texture"],
  textura:  ["gritty warm urban texture", "light vinyl crackle"],
};

// Defaults por estilo cuando modo = "auto" (sin pedido explícito). Edítalo a gusto.
export const HIBRIDO_POR_ESTILO: Partial<Record<Estilo, ComponenteHibrido[]>> = {
  urbano: ["bateria", "bajo", "textura", "pads"],
  cinematografico: ["pads"],
};

// Detección en el texto libre del usuario (ES/EN).
const DETECTORES: Record<ComponenteHibrido, RegExp> = {
  pads:     /\b(synths?|sintetizador\w*|sint[eé]tic\w*|pads?|ambient)(?![a-záéíóú])/i,
  guitarra: /\b(saturad\w*|saturated|overdrive|distors\w*|tube|v[aá]lvula\w*|fuzz)(?![a-záéíóú])/i,
  bateria:  /\b(808|trap|boom ?bap|drum machine|caja de ritmos|urban\w*|beats?)(?![a-záéíóú])/i,
  bajo:     /\b(sub-?bass|sub ?bajo|808|bajo profundo|bass drop)(?![a-záéíóú])/i,
  textura:  /\b(lo-?fi|vinyl|vinilo|street|calle|gritty|urban\w*)(?![a-záéíóú])/i,
};

export function resolverInstrumentacion(p: Perillas): { modo: "acustico" | "hibrido"; componentes: ComponenteHibrido[] } {
  const modo = p.instrumentacion ?? "auto";
  if (modo === "acustico") return { modo: "acustico", componentes: [] };
  const detectados = (Object.keys(DETECTORES) as ComponenteHibrido[]).filter((c) => !!p.pedido && DETECTORES[c].test(p.pedido));
  const porEstilo = HIBRIDO_POR_ESTILO[p.estilo] ?? [];
  const lista = [...new Set<ComponenteHibrido>([...porEstilo, ...detectados, ...(p.componentes ?? [])])];
  if (modo === "hibrido" && lista.length === 0) lista.push("pads", "bateria");
  return { modo: lista.length ? "hibrido" : "acustico", componentes: lista };
}

// Regla de calidez: ningún elemento sintético entra "frío". Si le falta un calificador cálido, se le añade.
const RIESGO_FRIO = /synth|pads?\b|808|sub-?bass|drum machine|sampler|lead/i;
const CALIDO = /warm|analog|tape|saturated|tube|vinyl|gritty|punchy/i;
export const calidez = (t: string) => (RIESGO_FRIO.test(t) && !CALIDO.test(t) ? `warm analog ${t}` : t);

// ---------- 2. INTENSIDAD CREATIVA -> energía, tempo, instrumentación, dinámica ----------
export const INTENSIDAD: Record<Banda, { tags: string[]; bpm: [number, number] }> = {
  bajo:  { tags: ["sparse arrangement", "fingerpicked acoustic guitar", "soft brushed drums", "upright bass", "slow", "quiet dynamics"], bpm: [58, 76] },
  medio: { tags: ["mid-tempo", "strummed acoustic guitar", "warm electric bass", "live drum kit", "gentle build", "dynamic"], bpm: [78, 100] },
  alto:  { tags: ["driving rhythm", "overdriven electric guitar", "punchy live drums", "wide dynamics", "energetic", "big chorus"], bpm: [102, 124] },
  max:   { tags: ["explosive", "roaring band", "crashing cymbals", "distorted guitars", "stadium dynamics", "raw energy"], bpm: [126, 142] },
};

// ---------- 3. PROFUNDIDAD EMOCIONAL -> modo armónico, timbre vocal, textura ----------
export const PROFUNDIDAD: Record<Banda, { tags: string[]; modo: string }> = {
  bajo:  { tags: ["bright", "playful", "light-hearted", "clear vocal tone"], modo: "major" },
  medio: { tags: ["warm", "bittersweet", "heartfelt vocal", "expressive"], modo: "major-minor mix" },
  alto:  { tags: ["melancholic", "emotional vocal", "breathy", "cello pad", "minor key", "yearning"], modo: "minor" },
  max:   { tags: ["devastating", "cracking emotional voice", "whispered verses", "strings swell", "dark minor key", "cathartic"], modo: "minor" },
};

// ---------- 4. NIVEL EXPERIMENTAL -> texturas fuera de lo común SIN perder lo orgánico ----------
// Regla: lo experimental se logra con timbres cálidos y texturas reales; si entra algo sintético, pasa por calidez() (ver capa de instrumentación).
export const EXPERIMENTAL: Record<Banda, { tags: string[]; estructura: "clasica" | "extendida" | "fragmentada" | "libre" }> = {
  bajo:  { tags: ["classic songwriting", "familiar progression"], estructura: "clasica" },
  medio: { tags: ["unexpected key change", "found-sound percussion", "layered harmonies"], estructura: "extendida" },
  alto:  { tags: ["odd time signature", "prepared piano", "field recordings", "dissonant harmonies", "tape loops"], estructura: "fragmentada" },
  max:   { tags: ["avant-garde", "improvised feel", "spoken word passages", "bowed strings", "polyrhythm", "unconventional structure"], estructura: "libre" },
};

// ---------- 5. ESTILO NARRATIVO -> género base, tipo de voz, producción ----------
export const ESTILO: Record<Estilo, { tags: string[]; esEs: string[]; enEn: string[] }> = {
  confesional:    { tags: ["singer-songwriter", "indie folk", "diary-like intimacy", "bedroom-warm"], esEs: ["acoustic ballad latina", "trova"], enEn: ["indie folk"] },
  epico:          { tags: ["cinematic rock", "anthemic", "choir backing vocals", "orchestral percussion"], esEs: ["rock latino épico"], enEn: ["epic alternative rock"] },
  poetico:        { tags: ["art song", "poetic delivery", "piano and strings", "spacious reverb room"], esEs: ["canción de autor"], enEn: ["art folk"] },
  conversacional: { tags: ["talk-sing delivery", "laid-back groove", "casual vocal", "storytelling"], esEs: ["pop acústico latino"], enEn: ["acoustic pop"] },
  cinematografico:{ tags: ["film score feel", "slow-burn build", "ambient acoustic textures", "wide stereo"], esEs: ["balada cinematográfica"], enEn: ["cinematic ballad"] },
  urbano:         { tags: ["street poetry", "lo-fi live drums", "muted guitar", "gritty warm vocal"], esEs: ["rap melódico orgánico", "neo-soul latino"], enEn: ["organic hip-hop soul"] },
};

// ---------- 6. IMPERFECCIÓN HUMANA / QUINTO ACORDE -> anti-robot ----------
// Alta imperfección = micro-desafinaciones, respiraciones, timing suelto. Se resuelve conflicto con tags "pulidos".
export const IMPERFECCION: Record<Banda, { tags: string[]; ad: string[]; quitar: string[] }> = {
  bajo:  { tags: ["clean take", "tight timing"], ad: [], quitar: [] },
  medio: { tags: ["slight natural pitch drift", "audible breaths", "human timing"], ad: ["(mm)"], quitar: [] },
  alto:  { tags: ["imperfect vocal", "audible breaths", "slightly behind the beat", "room noise", "finger squeaks", "raw first take"], ad: ["(mm)", "(ah)"], quitar: ["polished", "tight timing", "clean take"] },
  max:   { tags: ["unpolished", "voice cracks", "off-grid drumming", "tape hiss", "single-take feel", "vulnerable delivery"], ad: ["(mm)", "(ah)", "(ay)"], quitar: ["polished", "tight timing", "clean take", "crisp"] },
};

// ---------- 7. FILTRO ANTI-ROBOT (SOLO CAPA DE VOZ) ----------
// Ya NO se prohíbe instrumentación (sintes, pads, electrónica, urbano). Solo se bloquea lo que vuelve robótica a la VOZ.
export const PROHIBIDOS_VOZ = [
  "autotune", "auto-tune", "vocoder", "robotic", "robot voice",
  "synthetic vocal", "synthetic voice", "vocal glitch", "pitch-quantized",
];

// ---------- 8. ESTRUCTURAS DE SECCIONES ----------
// líneas por sección y modificador opcional entre corchetes (verifica soporte en tu build de 1.5).
type Seccion = { tag: string; lineas: number; mod?: string };
export const ESTRUCTURAS: Record<string, Seccion[]> = {
  clasica: [
    { tag: "Intro", lineas: 0 }, { tag: "Verse", lineas: 4 }, { tag: "Chorus", lineas: 4 },
    { tag: "Verse", lineas: 4 }, { tag: "Chorus", lineas: 4 }, { tag: "Bridge", lineas: 4 },
    { tag: "Chorus", lineas: 4 }, { tag: "Outro", lineas: 2 },
  ],
  extendida: [
    { tag: "Intro", lineas: 0 }, { tag: "Verse", lineas: 6 }, { tag: "Chorus", lineas: 4 },
    { tag: "Verse", lineas: 6 }, { tag: "Chorus", lineas: 4 }, { tag: "Bridge", lineas: 6, mod: "building" },
    { tag: "Chorus", lineas: 4, mod: "full band" }, { tag: "Outro", lineas: 3 },
  ],
  fragmentada: [
    { tag: "Intro", lineas: 2, mod: "spoken" }, { tag: "Verse", lineas: 4 }, { tag: "Bridge", lineas: 3 },
    { tag: "Chorus", lineas: 4 }, { tag: "Verse", lineas: 4, mod: "stripped" }, { tag: "Bridge", lineas: 4, mod: "dissonant" },
    { tag: "Chorus", lineas: 4, mod: "fragmented" }, { tag: "Outro", lineas: 2, mod: "fading" },
  ],
  libre: [
    { tag: "Intro", lineas: 3, mod: "spoken" }, { tag: "Verse", lineas: 8 }, { tag: "Bridge", lineas: 4, mod: "improvised" },
    { tag: "Verse", lineas: 6, mod: "whispered" }, { tag: "Chorus", lineas: 4, mod: "cathartic" },
    { tag: "Bridge", lineas: 4 }, { tag: "Outro", lineas: 4, mod: "slow fade" },
  ],
};

// Guía de escritura de letra (el modelo falla cuando las líneas son largas o raras)
export const GUIA_LETRA: Record<Lang, { silabas: [number, number]; reglas: string[] }> = {
  es: { silabas: [6, 10], reglas: [
    "Sin abreviaturas ni números en dígitos: escribe 'dos mil' no '2000'.",
    "Evita sinalefas forzadas; si la línea se atora, parte en dos.",
    "Rima asonante simple en estribillo; el modelo la sostiene mejor que la consonante compleja.",
    "Sin anglicismos en el medio de una frase en español (rompe el acento).",
  ] },
  en: { silabas: [6, 9], reglas: [
    "Contractions escritas como se cantan (gonna, wanna) solo si quieres ese acento.",
    "Evita trabalenguas y cadenas de consonantes.",
    "Repite el gancho del chorus idéntico cada vez.",
  ] },
};

// ---------- 9. COMPOSITOR ----------
const mid = (r: [number, number], t: number) => Math.round(r[0] + (r[1] - r[0]) * t);
const dedupe = (a: string[]) => [...new Set(a.map((s) => s.trim()).filter(Boolean))];

export function traducirPerillas(p: Perillas) {
  const bI = banda(p.intensidad), bP = banda(p.profundidad), bX = banda(p.experimental), bM = banda(p.imperfeccion);
  const est = ESTILO[p.estilo];
  const generos = p.lang === "es" ? est.esEs : est.enEn;

  // Capa 2: instrumentación híbrida (se resuelve por modo, estilo y texto libre del usuario)
  const instr = resolverInstrumentacion(p);
  const capaInstr = instr.modo === "hibrido" ? instr.componentes.flatMap((c) => HIBRIDO[c]) : ACUSTICO_DEFAULT;

  // Orden = prioridad: VOZ -> ambiente -> género/estilo -> instrumentación -> intensidad -> profundidad -> experimental -> imperfección
  let tags = dedupe([
    ...CAPA_VOZ, ...BASE_AMBIENTE, ...generos, ...est.tags, ...capaInstr,
    ...INTENSIDAD[bI].tags, ...PROFUNDIDAD[bP].tags, ...EXPERIMENTAL[bX].tags, ...IMPERFECCION[bM].tags,
  ]);

  // Resolver conflictos: imperfección alta elimina tags "pulidos"
  const quitar = new Set(IMPERFECCION[bM].quitar);
  tags = tags.filter((t) => !quitar.has(t));
  // Si el híbrido trae batería o bajo propios, se quitan los equivalentes acústicos de intensidad para no pelear
  if (instr.componentes.includes("bateria")) tags = tags.filter((t) => !/brushed drums|live drum kit|punchy live drums/i.test(t));
  if (instr.componentes.includes("bajo")) tags = tags.filter((t) => !/upright bass/i.test(t));

  // CAPA 1: barrera anti-robot, solo términos que dañan la voz (la instrumentación NO se filtra)
  tags = tags.filter((t) => !PROHIBIDOS_VOZ.some((x) => t.toLowerCase().includes(x)));
  // CAPA 2: todo lo sintético entra con textura analógica cálida
  tags = tags.map(calidez);
  // Presupuesto: más de ~18 tags diluye. Recorta desde el final; la capa de voz va primero y nunca se toca.
  tags = dedupe(tags).slice(0, 18);

  const t = (p.intensidad % 25) / 25;
  const bpm = mid(INTENSIDAD[bI].bpm, t);
  const dur = p.duracionSeg ?? 180;
  const estructura = EXPERIMENTAL[bX].estructura;
  const secciones = ESTRUCTURAS[estructura] ?? ESTRUCTURAS.clasica ?? [];
  const guia = GUIA_LETRA[p.lang];

  // Esqueleto de letra: el A&R rellena con la letra real. Los ad-libs van en intro/bridge/outro.
  const ad = IMPERFECCION[bM].ad;
  const esqueleto = secciones
    .map((s, i) => {
      const cab = s.mod ? `[${s.tag} - ${s.mod}]` : `[${s.tag}]`;
      const cuerpo = Array.from({ length: s.lineas }, (_, k) => `{linea_${i}_${k} (${guia.silabas[0]}-${guia.silabas[1]} sílabas)}`);
      if (ad.length && ["Intro", "Bridge", "Outro"].includes(s.tag)) { const adVal = ad[i % ad.length]; if (adVal) cuerpo.push(adVal); }
      return [cab, ...cuerpo].join("\n");
    })
    .join("\n\n");

  return {
    caption: tags.join(", "),
    bpm,
    key_scale: PROFUNDIDAD[bP].modo, // mapea a tu parámetro de tonalidad (ej. "A minor" si eliges raíz)
    duration: dur,
    vocal_language: p.lang,
    estructura,
    capas: { voz: CAPA_VOZ, instrumentacion: instr }, // útil para debug/UI del A&R
    lyrics_skeleton: esqueleto,
    reglas_letra: guia.reglas,
  };
}

// Ejemplo
// Acústico puro (auto, sin pedido): voz natural + guitarra/batería reales
// traducirPerillas({ intensidad: 62, profundidad: 85, experimental: 40, estilo: "confesional", imperfeccion: 70, lang: "es" });
// Híbrido por pedido: el texto dispara pads + bajo + batería urbana, todo con calidez analógica y voz intacta
// traducirPerillas({ intensidad: 70, profundidad: 75, experimental: 55, estilo: "poetico", imperfeccion: 60, lang: "es",
//                    pedido: "quiero synth pads, sub bass profundo y beats urbanos" });

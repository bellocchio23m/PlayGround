// 5 real playable missions across the same dense district (different spawns,
// targets, fail states). All wired to the framework + world triggers.
import * as THREE from 'three';
import { MissionDef } from './framework';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export const MISSIONS: MissionDef[] = [
  {
    id: 'm1-ombra', name: '1 — Prima Ombra',
    briefing: 'Kestrel, attraversa il quartiere senza farti vedere e raggiungi il cortile nord. Osserva le pattuglie: i tetti bassi a ovest sono la via dei furbi.',
    objectives: [
      { id: 'reach-alley', text: 'Attraversa il vicolo ovest (o i tetti)', kind: 'reach', target: V(-14, 0, 8), radius: 4 },
      { id: 'reach-court', text: 'Raggiungi il cortile nord', kind: 'reach', target: V(2, 0, -20), radius: 4 },
    ],
    failOnDeath: true, rewardXp: 100, rewardTools: { knives: 1 },
    start: V(0, 0, 30),
  },
  {
    id: 'm2-lama', name: '2 — La Lama Silenziosa',
    briefing: 'Un luogotenente dei Corvi pattuglia la piazza. Due vie: alle spalle tra i tavolini, oppure sali sulle casse a est e cala dall\u2019alto. I coltelli dai muri bassi funzionano, ma fanno rumore.',
    objectives: [
      { id: 'kill-lt', text: 'Assassina il Luogotenente (furtivo o in combattimento)', kind: 'assassinate', target: 'target', count: 1 },
      { id: 'escape-m2', text: 'Sparisci: allontanati dalla piazza', kind: 'escape', target: V(-14, 0, 20), radius: 6 },
    ],
    failOnDeath: true, rewardXp: 180, rewardTools: { smoke: 1 },
    start: V(2, 0, 32),
  },
  {
    id: 'm3-verticale', name: '3 — Infiltrazione Verticale',
    briefing: 'Il documento è sul tetto est sorvegliato. Sali: ponteggi, casse, cornicioni. I tetti sono la tua strada.',
    objectives: [
      { id: 'climb-roof', text: 'Sali sul tetto est (quota > 7m nell\u2019area est)', kind: 'reach', target: V(20, 8.5, 0), radius: 8 },
      { id: 'take-doc', text: 'Recupera il documento', kind: 'collect', target: 'documento', radius: 3 },
    ],
    failOnDeath: true, rewardXp: 220, rewardTools: { knives: 2 },
    start: V(6, 0, 26),
  },
  {
    id: 'm4-sigillo', name: '4 — Il Sigillo',
    briefing: 'Il Sigillo è nel magazzino a nord. Entra, prendilo, esci. Le guardie hanno visto dei cadaveri prima d\u2019ora: nascondi i corpi restando in movimento.',
    objectives: [
      { id: 'enter-warehouse', text: 'Entra nel magazzino nord', kind: 'reach', target: V(2, 0, -38), radius: 5 },
      { id: 'take-relic', text: 'Recupera il Sigillo', kind: 'collect', target: 'relic', radius: 3 },
      { id: 'exfil', text: 'Porta il Sigillo al punto di estrazione (sud)', kind: 'reach', target: V(0, 0, 30), radius: 5 },
    ],
    failOnDeath: true, rewardXp: 280, rewardTools: { smoke: 1, knives: 1 },
    start: V(0, 0, 26),
  },
  {
    id: 'm5-fuga', name: '5 — Fuga dal Nido',
    briefing: 'Ti hanno incastrato: l’allarme suona all’inizio. Sopravvivi, rompi il contatto e sparisci nei vicoli a sud. Combatti solo se devi.',
    objectives: [
      { id: 'survive', text: 'Sopravvivi 45 secondi', kind: 'survive', count: 45 },
      { id: 'escape-final', text: 'Fuggi al punto di estrazione senza nemici vicini', kind: 'escape', target: V(0, 0, 34), radius: 5 },
    ],
    failOnDeath: true, rewardXp: 350, rewardTools: { smoke: 2 },
    start: V(0, 0, 10),
  },
  // ---- phase-3: linked sequel missions (world micro-zones required) ----
  {
    id: 'm6-silenzio', name: '6 — Silenzio sulla Villa',
    briefing: 'Dopo il Sigillo i Corvi blindano la villa nord, ma Kestrel conosce i Tetti Alti: sali da ovest con le passerelle, oppure striscia nel Vicolo delle Caldaie e sabota il quadro della piazza. Tre vie: passerella ovest (se l’hai sbloccata), tetti NW + drop, o terra tra stalli e casse. Mai visto, mai esistito: il bonus Fantasma qui vale doppio.',
    narrative: 'Il Sigillo e bruciato (m4) e la Fuga ti ha segnato (m5): i Corvi nascondono il libro mastro nella villa nord.',
    objectives: [
      { id: 'reach-villa', text: 'Avvicina la villa nord (terra, tetti o canale)', kind: 'reach', target: V(0, 0, -22), radius: 5 },
      { id: 'take-ledger', text: 'Recupera il libro mastro sul tetto della villa', kind: 'collect', target: 'doc-villa', radius: 3 },
      { id: 'exfil-quiet', text: 'Estrazione a sud senza allarmi', kind: 'escape', target: V(0, 0, 34), radius: 5 },
    ],
    failOnDeath: true, rewardXp: 400, rewardTools: { knives: 1, smoke: 1 },
    start: V(-6, 0, 28),
    spawns: [{ kind: 'guard', route: 4 }, { kind: 'guard', route: 0 }, { kind: 'elite', route: 4 }],
    setFlag: 'blackout-plaza',
    ghostBonusXp: 150,
  },
  {
    id: 'm7-caccia', name: '7 — Caccia al Corriere',
    briefing: 'Il Corriere dei Corvi — un ranger veloce — fa la spola tra piazza del Mercato e i tetti: lo incalzi, lui corre. Due vie: taglia per i tetti (E2->E3, scala est se aperta) e piomba dall’alto, oppure appostati tra le bancarelle e colpiscilo quando attraversa la piazza. Ucciso lui, sopravvivi alla reazione e sparisci a sud.',
    narrative: 'Il libro mastro (m6) nomina un corriere: e la gola dei Corvi. Kestrel gli da la caccia.',
    objectives: [
      { id: 'kill-runner', text: 'Assassina il Corriere (furtivo o dall’alto)', kind: 'assassinate', target: 'target', count: 1 },
      { id: 'hold-on', text: 'Sopravvivi 30 secondi alla reazione', kind: 'survive', count: 30 },
      { id: 'escape-hunt', text: 'Fuggi al punto di estrazione', kind: 'escape', target: V(0, 0, 34), radius: 5 },
    ],
    failOnDeath: true, rewardXp: 450, rewardTools: { smoke: 1, knives: 2 },
    start: V(0, 0, 30),
    spawns: [{ kind: 'ranger', route: 7 }, { kind: 'guard', route: 1 }, { kind: 'guard', route: 6 }],
  },
  {
    id: 'm8-corvo', name: '8 — Il Corvo',
    briefing: 'Il Corvo in persona ti aspetta nella Plaza del Mercato. FASE 1: isolalo — e un capitano con scorta (un bruto e una guardia); usa generatore e fumogeni per separarlo dal branco. FASE 2: ucciso il Corvo, tutta Porto Scuro ti crolla addosso — corri all’estrazione sud per vicolo, tetti o canale. Chiudi il cerchio, Kestrel.',
    narrative: 'Hai seguito la pista dal Sigillo (m4) al Corriere (m7): in cima c’e sempre stato lui, il Corvo.',
    objectives: [
      { id: 'kill-corvo', text: 'FASE 1 — Uccidi il Corvo nella piazza', kind: 'assassinate', target: 'target', count: 1 },
      { id: 'escape-corvo', text: 'FASE 2 — Fuggi all’estrazione sud', kind: 'escape', target: V(0, 0, 34), radius: 5 },
    ],
    failOnDeath: true, rewardXp: 550, rewardTools: { smoke: 2, knives: 1 },
    start: V(0, 0, 32),
    spawns: [{ kind: 'captain', route: 7 }, { kind: 'brute', route: 1 }, { kind: 'guard', route: 2 }],
    setFlag: 'corvo-dead',
  },
];

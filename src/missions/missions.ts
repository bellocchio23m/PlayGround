// 9 real playable missions across the same dense district (different spawns,
// targets, fail states). All wired to the framework + world triggers.
import * as THREE from 'three';
import { MissionDef } from './framework';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export const MISSIONS: MissionDef[] = [
  {
    id: 'm1-ombra', name: '1 — Prima Ombra',
    briefing: 'Kestrel, attraversa il quartiere senza farti vedere e raggiungi il cortile nord. VIA A: il vicolo ovest a terra, tra muri bassi e coperture. VIA B: i tetti bassi a ovest (vault) sopra le pattuglie. Osserva i coni di vista prima di muoverti.',
    objectives: [
      { id: 'reach-alley', text: 'Attraversa il vicolo ovest (o i tetti)', kind: 'reach', target: V(-14, 0, 8), radius: 4 },
      { id: 'reach-court', text: 'Raggiungi il cortile nord', kind: 'reach', target: V(2, 0, -20), radius: 4 },
    ],
    failOnDeath: true, rewardXp: 100, rewardTools: { knives: 1 },
    start: V(0, 0, 30),
  },
  {
    id: 'm2-lama', name: '2 — La Lama Silenziosa',
    briefing: 'Un luogotenente dei Corvi pattuglia la piazza. VIA A: alle spalle tra tavolini e stalli, basso tra le coperture. VIA B: sali sulle casse a est e cala dall\u2019alto (drop kill). I coltelli dai muri bassi funzionano, ma fanno rumore.',
    objectives: [
      { id: 'kill-lt', text: 'Assassina il Luogotenente (furtivo o in combattimento)', kind: 'assassinate', target: 'target', count: 1 },
      { id: 'escape-m2', text: 'Sparisci: allontanati dalla piazza', kind: 'escape', target: V(-14, 0, 20), radius: 6 },
    ],
    failOnDeath: true, rewardXp: 180, rewardTools: { smoke: 1 },
    start: V(2, 0, 32),
  },
  {
    id: 'm3-verticale', name: '3 — Infiltrazione Verticale',
    briefing: 'Il documento è sul tetto est sorvegliato. VIA A: i ponteggi a sud-est, rapidi ma esposti. VIA B: il canale a est, poi pipe climb sul muro e salto sul tetto E2 da nord. I tetti sono la tua strada: scegli il vento.',
    objectives: [
      { id: 'climb-roof', text: 'Sali sul tetto est (quota > 7m nell\u2019area est)', kind: 'reach', target: V(20, 8.5, 0), radius: 8 },
      { id: 'take-doc', text: 'Recupera il documento', kind: 'collect', target: 'documento', radius: 3 },
    ],
    failOnDeath: true, rewardXp: 220, rewardTools: { knives: 2 },
    start: V(6, 0, 26),
  },
  {
    id: 'm4-sigillo', name: '4 — Il Sigillo',
    briefing: 'Il Sigillo è nel magazzino a nord. VIA A: la porta frontale, dritto tra le guardie con i fumogeni. VIA B: il soppalco interno come osservatorio, poi cala dal tetto della villa. Le guardie hanno visto dei cadaveri prima d\u2019ora: nascondi i corpi restando in movimento.',
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
    briefing: 'Ti hanno incastrato: l’allarme suona all’inizio. VIA A: rompi il contatto con i fumogeni e sparisci nei vicoli a sud. VIA B: il canale a est fino all’uscita sud, poi tagli per la piazza. Sopravvivi e combatti solo se devi.',
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
    briefing: 'Dopo il Sigillo i Corvi blindano la villa nord. VIA A: sali dai Tetti Alti con le passerelle (o la passerella ovest se l’hai sbloccata) e cala sul tetto della villa. VIA B: striscia nel Vicolo delle Caldaie, sabota il quadro della piazza e avvicina la villa tra stalli e casse. Mai visto, mai esistito: il bonus Fantasma qui vale doppio.',
    narrative: 'Il Sigillo e bruciato (m4) e la Fuga ti ha segnato (m5): i Corvi nascondono il libro mastro nella villa nord.',
    approachA: 'Tetti: catena W1->Tetti Alti->passerella ovest (se sbloccata)->drop sul tetto della villa.',
    approachB: 'Terra: Vicolo delle Caldaie->sabota il quadro piazza->avvicina tra stalli e casse.',
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
    briefing: 'Il Corriere dei Corvi — un ranger veloce — fa la spola tra piazza del Mercato e i tetti: lo incalzi, lui corre. VIA A: taglia per i tetti (E2->E3, scala est se aperta) e piomba dall’alto. VIA B: appostati tra le bancarelle e colpiscilo quando attraversa la piazza. Ucciso lui, sopravvivi alla reazione e sparisci a sud.',
    narrative: 'Il libro mastro (m6) nomina un corriere: e la gola dei Corvi. Kestrel gli da la caccia.',
    approachA: 'Tetti: E2->E3 (plank), scala est se sbloccata, drop kill sul percorso del Corriere.',
    approachB: 'Piazza: appostamento tra stalli e casse, coltelli + generatore come copertura.',
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
    briefing: 'Il Corvo in persona ti aspetta nella Plaza del Mercato. VIA A: isolalo con generatore e fumogeni (capitano + scorta: separalo dal branco) e uccidilo in mischia. VIA B: tetti E2->E3 e drop kill dall’alto, poi FASE 2: tutta Porto Scuro ti crolla addosso — corri all’estrazione sud per vicolo, tetti o canale. Chiudi il cerchio, Kestrel.',
    narrative: 'Hai seguito la pista dal Sigillo (m4) al Corriere (m7): in cima c’e sempre stato lui, il Corvo.',
    approachA: 'Piazza: generatore + fumogeni per isolare il Corvo dalla scorta, kill in mischia.',
    approachB: 'Tetti: E2->E3 drop kill, poi fuga per canale o vicolo verso estrazione sud.',
    objectives: [
      { id: 'kill-corvo', text: 'FASE 1 — Uccidi il Corvo nella piazza', kind: 'assassinate', target: 'target', count: 1 },
      { id: 'escape-corvo', text: 'FASE 2 — Fuggi all’estrazione sud', kind: 'escape', target: V(0, 0, 34), radius: 5 },
    ],
    failOnDeath: true, rewardXp: 550, rewardTools: { smoke: 2, knives: 1 },
    start: V(0, 0, 32),
    spawns: [{ kind: 'captain', route: 7 }, { kind: 'brute', route: 1 }, { kind: 'guard', route: 2 }],
    setFlag: 'corvo-dead',
  },
  {
    id: 'm9-eco', name: '9 — Eco del Corvo',
    briefing: 'Il Corvo è caduto, ma i suoi corrieri hanno sparso due rapporti prima di sparire: raccoglili e lascia Porto Scuro. VIA A: tetto della villa dal cunicolo ovest e dai tetti bassi, poi mercato a terra. VIA B: tutto a terra — mercato prima, villa poi — tra stalli, cunicoli e nascondigli. Poca resistenza: i Corvi rimasti sono allo sbando.',
    narrative: 'Dopo la caduta del Corvo (m8), Porto Scuro trattiene il fiato: due rapporti vagano senza padrone. Kestrel chiude il cerchio.',
    objectives: [
      { id: 'eco-intel-1', text: 'Recupera il rapporto sul tetto della villa', kind: 'collect', target: 'intel-eco-1', radius: 3 },
      { id: 'eco-intel-2', text: 'Recupera il rapporto al mercato', kind: 'collect', target: 'intel-eco-2', radius: 3 },
      { id: 'eco-exfil', text: 'Lascia Porto Scuro (estrazione sud)', kind: 'escape', target: V(0, 0, 34), radius: 5 },
    ],
    failOnDeath: true, rewardXp: 220, rewardTools: { smoke: 1 },
    start: V(-2, 0, 30),
    spawns: [{ kind: 'guard', route: 7 }, { kind: 'guard', route: 1 }],
    ghostBonusXp: 80,
    approachA: 'Tetti: cunicolo ovest->tetti bassi->villa (rapporto 1), poi drop e mercato a terra (rapporto 2).',
    approachB: 'Terra: mercato (rapporto 2) tra stalli e nascondigli, poi villa via cunicolo ovest o canale.',
  },
];

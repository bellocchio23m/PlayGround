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
    briefing: 'Un luogotenente dei Corvi pattuglia la piazza. Eliminalo senza allarme: avvicinati alle spalle, accovacciati, o cala dall\u2019alto.',
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
    briefing: 'Ti hanno incastrato: l\u2019allarme suona all\u2019inizio. Sopravvivi, rompi il contatto e sparisci nei vicoli a sud. Combatti solo se devi.',
    objectives: [
      { id: 'survive', text: 'Sopravvivi 45 secondi', kind: 'survive', count: 45 },
      { id: 'escape-final', text: 'Fuggi al punto di estrazione senza nemici vicini', kind: 'escape', target: V(0, 0, 34), radius: 5 },
    ],
    failOnDeath: true, rewardXp: 350, rewardTools: { smoke: 2 },
    start: V(0, 0, 10),
  },
];

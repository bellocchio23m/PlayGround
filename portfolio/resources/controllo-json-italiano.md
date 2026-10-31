# Controllare un JSON tradotto prima della consegna

Una consegna utile permette a chi riceve il lavoro di distinguere gli errori ancora aperti dalle scelte intenzionali. Questo schema serve per piccoli cataloghi di stringhe JSON.

Parti dalla versione sorgente concordata. Elenca i file target e conserva una copia degli input. Confronta le chiavi presenti nei due lati e separa quelle mancanti da quelle aggiunte. Verifica le stringhe vuote, poi controlla che i placeholder come `{name}` mantengano il nome e il numero di occorrenze richiesti.

Per ogni risultato, annota una decisione concreta. Una chiave extra può appartenere a una funzionalità rimossa oppure segnalare che hai confrontato versioni diverse. Non cancellarla automaticamente solo per rendere pulito il report.

La revisione successiva riguarda il prodotto reale. Apri le schermate, controlla testo tagliato, ritorni a capo, direzione della scrittura e contesto. Chiedi una revisione linguistica adeguata prima di dichiarare approvato il testo.

LocaleCheck offre un workspace offline EN/IT e una CLI Python opzionale per JSON piatti o annidati con foglie stringa. Esporta report HTML, CSV e JSON. I limiti dichiarati sono 5 MiB per file, 10.000 chiavi e 64 livelli. Array, ICU/plurali e valutazione linguistica richiedono strumenti e verifiche diversi.


[LocaleCheck download and current price](https://bellocchio2.gumroad.com/l/localecheck-json) · [Free fictional interface example](../localization/README.md)

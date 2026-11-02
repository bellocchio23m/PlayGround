# Bilingual interface and contract checks

Original demonstration by Marco Bellocchio. This is a fictional booking preview, not previous client work. It does not create appointments, contact a server, or collect customer information.

The self-contained HTML/CSS/JavaScript interface switches between English and Arabic, including document language, direction, labels and selected-time feedback. The displayed availability is illustrative.

## Run the preview

Serve this directory on a loopback address with Python, then open the local URL:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

## Run the checks

Use Python 3.10 or newer in a virtual environment. Install Playwright and its Chromium browser, then run the script:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install playwright
python -m playwright install chromium
python checks.py
```

On Linux, if `chromium` is already on PATH, the script uses that executable. Set `CHROMIUM_PATH` to select another installed Chromium path. Browser dependencies must be available on the host. No hosted service, paid account or API key is needed.

The script starts its own loopback HTTP server, runs the browser, saves `verifica-regressione.json`, and closes both browser and server. It requires no additional web server or scheduled task.

## What is checked

Six baseline cases cover English/Arabic at viewport widths of 320, 390 and 1280 CSS pixels. The checks inspect document language and direction, horizontal overflow, single selected-time state and selected-time feedback.

Three negative controls change only the browser's temporary DOM: wrong document direction, lost pressed state, and stale feedback. Each control passes only if the exact expected error is detected. The original HTML fixture stays unchanged. See `recorded-checks.json` for a recorded run against this fixture on 26 October 2026.

These results cover Chromium and this fixture only. They are not linguistic certification, a full accessibility audit, support for every browser, or validation of a booking backend. Visual and assistive-technology review remain separate tasks for a real product.

## Your JSON translation checks don't need a monthly bill

**Check locally. Pay once. Keep your files under your control.**

[LocaleCheck 1.2](https://bellocchio2.gumroad.com/l/localecheck-json) is a separate downloadable workspace for checking JSON translation files before release or handoff. [Try the free live demo first](https://localecheck-demo.bellocchio23.chatgpt.site/) — no signup; one pair, 100 keys and 20 KiB per input. Buying is optional and is not required to inspect this interface demonstration.

The current kit checks missing/extra keys, blank translations, simple ASCII `{name}` occurrence counts and documented ICU MessageFormat 1 syntax, argument roles and branch contracts. It accepts flat or nested JSON objects with string leaves, compares up to 20 targets and exports HTML/CSV/JSON reports. The EN/IT browser workspace and bundled Node CLI run without installing dependencies or contacting an API; the legacy Python 1.1 CLI remains simple-mode only.

The EUR29 one-time list price buys the delivered version. Checkout shows applicable taxes and currency. No subscription is required to run the downloaded kit; future updates and custom services are not promised. Original files are not modified or uploaded. Source, fictional examples, documentation, licences and automated tests are included. The current release was verified with 55 Node tests, ZIP integrity checks and Chromium previews; local-file launch, Firefox, Safari and physical phones were not independently verified in this environment.

This checks structure, not translation quality or actual on-screen rendering. Arrays, empty objects, MessageFormat 2, printf and HTML validation are outside scope. [Read the current product page for exact formats, ICU limits, requirements and licence](https://bellocchio2.gumroad.com/l/localecheck-json).

### Challenge the next subscription

**Which recurring localization task would you stop paying for if you could do it reliably on your own computer?** [Describe your real workflow in the public roadmap thread](https://github.com/bellocchio23m/PlayGround/issues/7): file format, current workaround, time/cost and a concrete acceptance test. Use fictional examples.

A separate private preview explores glossary rules, source-change review, exact-text reuse, pseudolocalization and portable review projects. These extras are not in the public kit yet; this feedback invitation is not a new product release.

### Small fictional example before buying

This separate JSON example illustrates the paid kit's narrow checks; it does not require the interface demonstration. It is not a previous customer's file.

Source `en.json`:

```json
{"welcome": "Hello {name}", "cta": "Continue"}
```

Deliberately broken target `it-broken.json`:

```json
{"welcome": "Ciao", "extra": "Demo"}
```

Running the kit's `python localecheck.py en.json it-broken.json` on 26 October 2026 returned exit code 1 and exactly these three findings:

- `cta`: `missing_key`;
- `extra`: `unexpected_key`;
- `welcome`: `placeholder_mismatch`, missing `{name}`.

This checks structure, not whether the Italian wording is correct. Invalid inputs return exit code 2; a valid matching target returns 0. That recorded example used the older simple-mode CLI. The current 1.2 workspace additionally supports the documented ICU MessageFormat 1 checks; arrays and linguistic quality remain outside scope. If you need broader free checks, compare [Lingual i18n-check (MIT)](https://github.com/lingualdev/i18n-check) before purchasing. No hosted account or API is required by the offline utility.

A separate [fictional PDF-to-Excel demonstration](../invoice-demo/) includes two generated sample invoices, a workbook generator and six reproducible checks. One deliberately inconsistent source total is retained and flagged. It supports the two demonstrated one-page layouts only; it is not a general invoice extractor or a previous client result.

## Practical review worksheets

Use the free [release checklist](../resources/json-release-checklist.md) to freeze source/target revisions before checking files. The [format decision table](../resources/json-format-fit.md) helps decide whether a schema fits LocaleCheck. A [handover template](../resources/localization-handover.md) records unresolved findings and actual release decisions. [Read the Italian workflow](../resources/controllo-json-italiano.md) or [browse all free resources](../resources/README.md).

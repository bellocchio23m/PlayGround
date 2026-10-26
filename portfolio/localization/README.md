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

## Optional JSON-file checks

The browser demonstration above is free to inspect. For a separate offline review of JSON translation files, [LocaleCheck 1.1.0 is available for EUR29, once](https://bellocchio2.gumroad.com/l/localecheck-json). It includes a browser workspace that needs no installation or Python, an optional Python 3.10+ standard-library CLI, flat and nested fictional examples, HTML/CSV/JSON reports, 21 automated Python test methods, bilingual guides and a two-page PDF quick start. The new workspace was checked in managed Chromium with file inputs and downloads while offline; other browser engines and the buyer's local-file launch were not independently tested.

It checks missing/extra keys, blank translations and ASCII `{name}` placeholders. Flat JSON and nested objects with string leaves are supported; arrays, ICU/plurals, HTML and linguistic quality are outside scope. The store lists the licence, requirements and checkout total; there is no subscription. Buying the kit is optional and is not required to run this interface demonstration.

Before buying, read the [format limits, free alternative and support guide](https://bellocchio2.gumroad.com/). The purchase delivers the downloadable kit through Gumroad; it does not include custom freelance services.

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

This checks structure, not whether the Italian wording is correct. Invalid inputs return exit code 2; a valid matching target returns 0. Version 1.1 additionally accepts nested objects with string leaves and uses JSON pointers in those reports. ICU, arrays and linguistic quality remain outside scope. If you need broader free checks, compare [Lingual i18n-check (MIT)](https://github.com/lingualdev/i18n-check) before purchasing. No hosted account or API is required by the offline utility.

A separate [fictional PDF-to-Excel demonstration](../invoice-demo/) includes two generated sample invoices, a workbook generator and six reproducible checks. One deliberately inconsistent source total is retained and flagged. It supports the two demonstrated one-page layouts only; it is not a general invoice extractor or a previous client result.

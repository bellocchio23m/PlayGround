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

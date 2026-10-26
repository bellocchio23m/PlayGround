"""Local browser contract checks with deliberately failing controls.

Runs only against the original fictional booking demo, with no remote requests.
"""
import asyncio
import functools
import json
import os
import shutil
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

BASE = Path(__file__).parent

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

async def inspect_contract(page, language):
    state = await page.evaluate("""() => ({
        lang: document.documentElement.lang,
        dir: document.documentElement.dir,
        overflow: document.documentElement.scrollWidth > innerWidth,
        selected: document.querySelectorAll('.time[aria-pressed=true]').length,
        selectedText: document.querySelector('#selection').textContent
    })""")
    errors = []
    if state['lang'] != language:
        errors.append('document_language')
    if state['dir'] != ('rtl' if language == 'ar' else 'ltr'):
        errors.append('document_direction')
    if state['overflow']:
        errors.append('horizontal_overflow')
    if state['selected'] != 1:
        errors.append('single_selection')
    if '14:00' not in state['selectedText']:
        errors.append('selection_feedback')
    return errors

async def main():
    report = {'baseline': [], 'negative_controls': [], 'external_requests': [], 'javascript_errors': []}
    server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(BASE)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        async with async_playwright() as p:
            executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            browser = await p.chromium.launch(headless=True, executable_path=executable)
            try:
                page = await browser.new_page()
                page.on('pageerror', lambda e: report['javascript_errors'].append(str(e)))
                page.on('request', lambda r: report['external_requests'].append(r.url) if not r.url.startswith('http://127.0.0.1:') else None)
                url = f'http://127.0.0.1:{server.server_port}/index.html'
                for width in [320, 390, 1280]:
                    await page.set_viewport_size({'width': width, 'height': 1000})
                    await page.goto(url)
                    for language in ['en', 'ar']:
                        await page.locator(f'[data-language={language}]').click()
                        await page.locator('.time').filter(has_text='14:00').click()
                        errors = await inspect_contract(page, language)
                        report['baseline'].append({'width': width, 'language': language, 'errors': errors})
                        assert not errors, errors
                controls = [
                    ('wrong_direction', "document.documentElement.dir='ltr'", ['document_direction']),
                    ('lost_pressed_state', "document.querySelectorAll('.time').forEach(e=>e.setAttribute('aria-pressed','false'))", ['single_selection']),
                    ('stale_feedback', "document.querySelector('#selection').textContent='11:30'", ['selection_feedback']),
                ]
                for name, mutation, expected in controls:
                    await page.goto(url)
                    await page.locator('[data-language=ar]').click()
                    await page.locator('.time').filter(has_text='14:00').click()
                    assert not await inspect_contract(page, 'ar')
                    await page.evaluate(mutation)
                    errors = await inspect_contract(page, 'ar')
                    report['negative_controls'].append({'name': name, 'expected': expected, 'observed': errors, 'passed': errors == expected})
                    assert errors == expected, (name, errors)
            finally:
                await browser.close()
    finally:
        server.shutdown()
        server.server_close()
    assert not report['external_requests'] and not report['javascript_errors']
    report['scope'] = 'Chromium and this fictional fixture only; not linguistic review or full accessibility certification.'
    (BASE/'verifica-regressione.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps({'baseline_passed': len(report['baseline']), 'negative_controls_detected': len(report['negative_controls']), 'external_requests': 0, 'javascript_errors': 0}))

if __name__ == '__main__':
    asyncio.run(main())

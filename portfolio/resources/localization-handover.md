# A localization handover note a teammate can act on

Copy this template into an issue or release note and replace every bracketed field. Keep customer strings and confidential paths in your team's approved system.

## Review record

- Source locale and revision — [file / commit]
- Target locales and revisions — [list]
- Tool and version — [name / version]
- Check scope — [key sets / blank strings / named placeholders]
- Report location — [approved internal location]
- Checked by and date — [actual operator / date]

## Findings requiring a decision

| Path | Finding | Owner | Decision | Evidence |
| --- | --- | --- | --- | --- |
| [path] | [missing key] | [person] | [fix / defer / intentional] | [issue] |

## Release sign-off

Record unresolved findings explicitly. “Deferred until next release” should name the responsible person and the intended release. Keep the report next to the exact input revision so another person can reproduce it.

For an external handover, share a sanitized report and only the necessary example strings. Placeholder names and key paths may reveal internal product features even when translations look harmless.

LocaleCheck exports HTML, CSV and JSON reports for its supported schemas. Those reports provide structural findings. The template's sign-off fields must be completed by the actual people responsible for the release.


[LocaleCheck download and current price](https://bellocchio2.gumroad.com/l/localecheck-json) · [Free fictional interface example](../localization/README.md)

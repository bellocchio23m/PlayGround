# JSON translation release checklist

A practical worksheet for a small team handing over translated JSON strings. Use a copy of the release candidate and fictional data when demonstrating a problem.

1. Identify the source locale and freeze its filename or commit. Comparing targets against different source versions creates confusing results.
2. List the target locales expected in this release. Record intentionally deferred locales separately.
3. Compare key sets. A missing target key and a target key removed from the source require different decisions.
4. Inspect empty strings. Decide explicitly whether an empty label is permitted for that field.
5. Compare named placeholders, including repetitions. A translated sentence may move a placeholder while still needing the same count.
6. Ask a language reviewer to check wording, tone and context. Structural checks cannot decide whether a translation is correct.
7. Open important screens in the target language. Check wrapping, direction and layout with representative text.
8. Save the report together with the input version. Assign unresolved findings an owner and a release decision.

A useful handover note says which files were reviewed, which checks ran, what remains unresolved and who approved exceptions. Avoid a blanket “translations validated” statement when only JSON structure was inspected.

LocaleCheck covers a narrow subset of this workflow for flat or nested string objects. Arrays, ICU/plurals, printf placeholders and linguistic review need a different process.


[LocaleCheck download and current price](https://bellocchio2.gumroad.com/l/localecheck-json) · [Free fictional interface example](../localization/README.md)

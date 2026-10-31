# Review named placeholders without rejecting word order changes

These are fictional examples of ASCII named placeholders, not customer material.

Source:

```json
{"greeting":"Hello {name}","confirmation":"{name}, confirm for {name}"}
```

A target may place a placeholder elsewhere in the sentence. For a count-based check, the important facts are the placeholder name and how often it occurs in each string.

| Target example | Finding to investigate |
| --- | --- |
| `Ciao {name}` | Same named placeholder count for greeting |
| `Ciao` | Missing `{name}` |
| `Ciao {username}` | Different placeholder name |
| `{name}, conferma` | One occurrence lost from confirmation |

When a mismatch appears, confirm the intended runtime template before editing the target. A placeholder may have been removed deliberately in a source change, or the translation may correspond to an older revision. Preserve both input versions while resolving that uncertainty.

LocaleCheck reports ASCII `{name}` count mismatches. This worksheet does not extend that support to ICU, printf, escaping rules of arbitrary frameworks or template execution. Validate those with the relevant application tooling. A matching count still needs a screen-level and language review.


[LocaleCheck download and current price](https://bellocchio2.gumroad.com/l/localecheck-json) · [Free fictional interface example](../localization/README.md)

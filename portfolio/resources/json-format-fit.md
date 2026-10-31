# Choose a JSON localization check that fits your files

Before choosing a tool, inspect a small representative source file. The filename extension alone does not tell you whether the format is supported.

| Example input | LocaleCheck 1.1 fit | Next decision |
| --- | --- | --- |
| Flat object with string values | Supported | Compare source and targets |
| Nested objects ending in strings | Supported | Review paths in the report |
| Arrays of labels | Unsupported | Use a checker designed for this schema |
| Empty nested objects | Unsupported | Resolve the schema deliberately |
| ICU plural or select expressions | Outside its checks | Use an ICU-aware validator |
| printf-style placeholders | Outside its checks | Use a matching format validator |
| HTML inside strings | No HTML validation | Test markup separately |

LocaleCheck limits are 5 MiB per file, 10,000 string keys and 64 levels. It compares up to 20 target files in its offline HTML workspace. An optional Python 3.10+ CLI is included.

Make a purchasing decision using an actual representative schema. If your project mixes supported JSON with ICU messages, split responsibility explicitly and document the gap. A clean structural report does not approve linguistic quality, application behavior or every message format used elsewhere in the project.


[LocaleCheck download and current price](https://bellocchio2.gumroad.com/l/localecheck-json) · [Free fictional interface example](../localization/README.md)

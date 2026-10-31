# Review translation-file structure without a hosted upload

A team may want to inspect localization structure on its own workstation before sharing files with another service. Start by defining which files the operator may access and where reports may be stored.

A local workflow can be simple. Copy the approved source and target catalogs into a working folder, run the structural review, and keep the resulting report beside an input-version note. Share only the findings needed by the translator or developer. Key paths, string values and exported reports should follow the same handling rules as their source files.

LocaleCheck's HTML workspace performs its file comparisons offline, and its optional Python CLI uses the standard library. Its scope is missing and extra keys, blank translations and ASCII named-placeholder counts for supported JSON string objects. Up to 20 target files can be compared in the workspace.

Local processing still leaves responsibilities with the operator. Browser downloads, copied inputs, backups and reports remain files to manage. An offline utility does not establish an organization's regulatory compliance, data policy or complete security posture.

Before buying, inspect the published format limits and fictional example. If the source uses arrays, empty objects, ICU or printf placeholders, select tooling that explicitly supports those formats.


[LocaleCheck download and current price](https://bellocchio2.gumroad.com/l/localecheck-json) · [Free fictional interface example](../localization/README.md)

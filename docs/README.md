# LocaleCheck public demo

Self-contained static copy of the existing public LocaleCheck 1.2 demonstration. This does not publish the private 1.3 preview or a new commercial kit.

## Hosting setup

GitHub repository settings → Pages → Build and deployment:

- Source: Deploy from a branch
- Branch: portfolio-localization-demo
- Folder: /docs

Save the settings, wait for the Pages deployment, and verify the URL GitHub reports. Hosting activation has not been confirmed yet. If a different Pages source is already in use, preserve it and review the deployment plan before replacing it.

## Files and integrity

- `localecheck/index.html`: standalone EN/IT demo, one pair, 100 string keys, 20 KiB per input.
- SHA-256: `1a0ae986f73b5eda32f6195ada021f10639e762219a5a9b68e99e81b237d9672`.
- `index.html`: relative redirect to the demo.
- `.nojekyll`: static serving without Jekyll processing.

The demo content is byte-for-byte identical to the previously verified source. No remote translation or input upload is performed by the demo code. The full kit remains a separate purchase through the product link. Future changes require their own checks.

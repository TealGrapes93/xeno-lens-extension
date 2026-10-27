# Contributing to Xeno-Lens

Thanks for wanting to help. Useful areas right now are better text-block detection on specific sites, the local statistics, and provider support.

## Set up for local development

1. Fork the repo on GitHub, or clone it directly.

   PowerShell (Windows):

   ```powershell
   git clone https://github.com/TealGrapes93/xeno-lens-extension.git
   Set-Location xeno-lens-extension
   ```

   Bash (macOS / Linux):

   ```bash
   git clone https://github.com/TealGrapes93/xeno-lens-extension.git
   cd xeno-lens-extension
   ```

2. Load the folder as an unpacked extension (see Install in the [README](README.md)).
3. After you edit a file, click the reload button for Xeno-Lens on the extensions page, then refresh the tab you're testing on.

There is no build step. The extension is plain JavaScript.

## Making a change

1. Create a branch:

   ```bash
   git checkout -b my-change
   ```

2. Keep each pull request to one change, and say which sites and which provider you tested on.
3. Don't commit API keys, and don't commit packaged `.zip` builds.
4. Push your branch and open a pull request.

## Code of conduct

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

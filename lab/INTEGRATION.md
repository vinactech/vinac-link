# Integration into vinacfm.com

## Safest first deployment

Serve this directory unchanged as static content at:

`https://vinacfm.com/lab/nus/`

The app has no external package dependencies and no build step.

Required files/directories:

```
/lab/nus/index.html
/lab/nus/styles.css
/lab/nus/js/*
/lab/nus/worklets/*
```

AudioWorklet modules must be served from the same secure origin or a compatible CORS/CSP policy.

## HTTPS requirement

Two-device tests require microphone permission. Deploy over HTTPS. `localhost` works for development; arbitrary LAN HTTP addresses usually do not qualify as secure contexts.

## Content Security Policy

This package does not need remote scripts. A restrictive CSP can be used. Ensure the site policy permits:
- same-origin JavaScript modules;
- AudioWorklet module loading;
- `blob:` URLs for local report downloads;
- microphone permission for the lab route.

## Existing tester

Do not replace `/demos/near-ultrasound-tester` initially. Run the new lab in parallel until a real device matrix has been collected.

## Recommended production integration sequence

1. Static deploy under `/lab/nus/`.
2. Test Chrome/Edge macOS/Windows, Safari macOS/iOS, Chrome Android.
3. Collect JSON reports for device pairs.
4. Fix compatibility issues in the isolated lab.
5. Only then integrate its engine modules into the main site's framework if desired.

## No backend required for v0.1

The temporary test key is passed in the URL fragment. Fragments normally remain client-side and are not included in the HTTP request. Do not add analytics that collect fragments.

For a later coordinated benchmark service, create a minimal ephemeral session backend that stores only non-secret run coordination/metrics. Do not upload microphone audio by default.

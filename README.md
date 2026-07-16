# Qortium Boards

Boards is an original QDN discussion app for durable community knowledge. It
organizes public content as topics, threads, opening posts, and replies, while
keeping reactions, edits, moderation, native polls, attachments, and QORT tip
receipts in separate authenticated records.

Published app identity: `qdn://APP/Boards/Boards`.

## Design and trust model

- Every discussion record is public QDN data. The app does not imply private or
  encrypted access.
- Record authority is derived from confirmed Core transactions. Author edits
  must come from the original creator address; display names are not authority.
- Ordering uses `(blockHeight, signature)`, not client timestamps.
- Reactions are isolated per creator address and cannot overwrite content.
- Moderation is accepted only from the app publisher address or addresses in a
  publisher-signed configuration record.
- Native polls and votes use Core transactions.
- Tip totals include only receipts whose confirmed PAYMENT transaction matches
  the publisher, recipient, and amount.

## Development

```sh
npm install
npm run dev -- --host 127.0.0.1
npm test
npm run build
```

The browser fallback reads a local Core at `http://127.0.0.1:24891`; override it
with `VITE_QORTIUM_NODE_API_URL`. Browser development is intentionally
read-only. Publishing and signing actions are available only through Qortium
Home.

## Qortium display integration

Boards follows Home's inherited `theme`, `accent`, `textSize`, `language`, and
`uiStyle` settings. Classic is the safe default, while Modern and Fun provide
their specified geometry, type, and chrome without replacing the selected Home
accent. The layout is responsive down to 320px and explicitly reflows for the
2.1x `huge` text setting.

## Versioning

Boards follows the Qortium app versioning standard (QAVS). Version `1.5.0`
declares a minimum Qortium platform level of 1.5 and the first app release at
that platform level. The build emits `dist/qortium-app.json`.

## Publishing

`npm run qdn:publish` builds and publishes `dist/` as
`qdn://APP/Boards/Boards` through a synced local Previewnet Core. Defaults use:

- `/home/user/qortium/git/qortium-core/preview/apikey.txt`
- `/home/user/qortium/git/qortium-core/preview/secrets/initial-minting-accounts.json`

Override with the `QORTIUM_BOARDS_*` environment variables documented in
`scripts/publish-qdn.mjs`. Publishing is an explicit operator action; tests and
ordinary builds never publish.

## Current boundaries

- Board records use the `JSON` QDN service and are limited to 24,000 encoded
  bytes.
- Attachments publish separately under the `ATTACHMENT` service.
- QORT tips require Home's trusted local/custom-node signing path and are hidden
  when Home reports public-node mode.
- Deletion publishes a tombstone. It cannot erase existing QDN history.

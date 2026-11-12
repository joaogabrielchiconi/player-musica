# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static HTML, CSS and ES modules, no framework and no build step. Hosted on GitHub Pages and installed as a PWA from Safari ("Adicionar à Tela de Início"). Existing codebase: css/app.css, index.html, js/ui.js, js/app.js.

## Users

One person: the owner, on an iPhone 17 Pro Max, signed in with their own Google account. Daily use, often one-handed and often with the screen locked: in the car, at home, walking. The job: put on music from a Google Drive folder, keep playing, find a song or album fast, and have chosen songs and playlists work offline.

## Product Purpose

A personal music player for MP3s the owner already keeps in a Google Drive folder ("Músicas"), at zero cost, replacing a paid streaming subscription they cannot afford right now. Streams from Drive, downloads chosen songs or playlists for offline listening, keeps playlists with a backup in the owner's Drive. Success: it plays reliably with the screen locked, resumes where it stopped, and works in airplane mode.

## Positioning

It is the owner's own library, not a catalogue: no recommendations, accounts, ads or subscription. Everything shown is something they put in their Drive.

## Operating Context

Playback happens mostly outside the app (lock screen, headphones, car). In the app the owner browses by song, artist, album, playlist and downloaded, searches by title, artist or album ignoring accents, and queues downloads over Wi-Fi or 4G. Without internet, songs not downloaded are dimmed and do not play. The Google login lasts about an hour; renewing is one tap on "Entrar com Google".

## Capabilities and Constraints

- Tabs: Músicas, Artistas, Álbuns, Playlists, Baixadas. Search, "Só baixadas" filter, album/artist/playlist detail, add to playlist (single song or whole album/artist), playlist edit (reorder, remove, rename, delete), download and delete download, storage panel, mini player and full-screen player with queue, shuffle, repeat, seek.
- Known gaps that the design must carry honestly: the lock-screen play/pause icon can show the wrong state (accepted limitation); very large files start slowly because the whole file downloads before playing; the songs have no cover art in their tags yet (the design must hold up with no cover).
- Touch targets of at least 44 pt, safe areas of the iPhone respected in standalone mode.
- Currently provisional UI uses the browser's prompt() and confirm() for names and confirmations; the design replaces them with in-app screens.
- Must not change playback behaviour (js/player.js, js/queue.js), login, Drive access, sync, storage or offline logic.

## Brand Commitments

App name: "Músicas" (home screen icon, title, manifest). Interface language: Brazilian Portuguese, short direct texts. No other brand assets exist yet; the app icon is created in T14.

## Evidence on Hand

Real library: a handful of MP3s from the owner's Drive, tagged only with an encoder frame, so artist and album come from file names and folders. No cover art exists in the files today. No logo, no screenshots of a previous design.

## Product Principles

1. The owner's own music comes first; the interface stays out of the way of playing it.
2. One-handed, glanceable, reachable: primary controls live where the thumb is.
3. Honest state: say what is offline, downloading, expired or removed, plainly and without alarm.
4. Nothing the owner did not put there: no invented content, no engagement mechanics.
5. Works without internet and without cover art as a normal case, not a failure.

## Accessibility & Inclusion

Strong default: high contrast on a dark ground, 44 pt minimum touch targets, labels on all icon buttons, visible focus, honour iOS Dynamic Type via relative units where feasible and `prefers-reduced-motion`. Portuguese (pt-BR) throughout.

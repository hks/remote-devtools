---
layout: home

hero:
  name: Remote DevTools
  text: Your app's dev menu, on your computer
  tagline: Add a small SDK to your app, pair it with a QR code, and inspect logs, network traffic, state, storage and feature flags from a desktop app or a self-hosted web UI.
  image:
    src: /banner.webp
    alt: Remote DevTools
  actions:
    - theme: brand
      text: Get started
      link: /guide/introduction
    - theme: alt
      text: React Native quick start
      link: /guide/quick-start-react-native
    - theme: alt
      text: GitHub
      link: https://github.com/hks/remote-devtools

features:
  - icon: 📜
    title: Logs and network
    details: Structured logs, captured console output and every fetch / XMLHttpRequest / axios call, with HAR export.
  - icon: 🧩
    title: Functions
    details: Register functions in the app and run them from the UI, with typed arguments rendered as forms.
  - icon: 🧠
    title: State, storage and flags
    details: Live Redux / Zustand state with diffs, AsyncStorage / MMKV / localStorage browsing, and persistent flag overrides.
  - icon: 🧱
    title: Custom panels
    details: Describe your own tabs with tables, stats, forms and buttons; the UI draws them, your app handles the actions.
  - icon: 📡
    title: Pair any way
    details: QR code, 6-digit code, or automatic discovery of a local relay for simulators and development builds.
  - icon: 🔒
    title: Off in production
    details: The SDK does nothing unless you enable it. Nothing is stored in the UI; the relay only forwards messages.
---

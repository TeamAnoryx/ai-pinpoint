# AI Pinpoint

Pin any message in a Gemini, ChatGPT, or Claude conversation, then jump straight back to it.
Bookmarks for individual messages, kept on your device, working fully offline.

- **Pin** with the button on each message, the context menu, or `Alt+Shift+P` (pins the last reply).
- **Jump**: click a pinned card to scroll the conversation to that message and highlight it. This works even when the host has unloaded the message from the page.
- **Organise**: rename (`F2`), reorder (drag or `Alt+↑/↓`), filter, and browse the pinned threads under "All chats".
- **Own your data**: export and import as JSON, see storage use, prune old threads.
- **Private by construction**: no account, no servers, no analytics. The extension makes no network requests at all; the build fails if any network-capable code appears.

Supported sites: `gemini.google.com`, `chatgpt.com`, `chat.openai.com`, `claude.ai`. Requires Chrome 114 or later.

## Install from source

```sh
pnpm i
pnpm build            # → dist/
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `dist/`.

To build the store package: `pnpm package` → `release/ai-pinpoint-<version>.zip` (no source maps, tests, or docs).
`pnpm smoke:package` builds, packages, extracts the zip, and smoke-tests it in Chromium.

## Development loop

```sh
pnpm dev              # build to dist/ and watch
pnpm lint && pnpm typecheck && pnpm test
pnpm test:e2e         # Playwright against local fixture pages (builds dist-e2e/)
```

- After changing the content script, reload the extension in `chrome://extensions` **and** reload the chat tab.
- E2E tests run on synthetic fixture pages served from `localhost`, never on real conversations. The E2E build (`dist-e2e/`) is the only build that matches `localhost` (`docs/DECISIONS.md` D-018).
- `E19_TRIALS=20 pnpm test:e2e` shortens the 100-trial navigation test while iterating.

## Architecture

| Path | Role |
|---|---|
| `src/background/` | Service worker. The single writer for storage, plus RPC, hotkeys, context menu, and export/import. Knows no host. |
| `src/content/adapters/` | The only code that knows host DOM: one adapter per site behind the `HostAdapter` contract. |
| `src/content/core/` | Engine: message identity, mutation observer, SPA thread watcher, navigator and recovery. |
| `src/content/overlay/` | Sidebar UI (Preact) inside a closed shadow root. |
| `src/popup/`, `src/options/` | Toolbar popup and options page. |

Start with `CLAUDE.md` (the rules), then `docs/ARCHITECTURE.md`. Design decisions and deviations are logged in `docs/DECISIONS.md`.

## When a host changes its page

Host redesigns are expected. The repair runbook is `docs/TESTING.md` §7 ("Regression suite for host changes"), and selectors live only in `src/content/adapters/` (`docs/ADAPTERS.md`). `pnpm fixture:capture` and `pnpm adapter:probe` help capture a scrubbed fixture and check each selector tier.

## Privacy

AI Pinpoint does not collect, transmit, or sell any data. See [`store/PRIVACY.md`](store/PRIVACY.md).

## License

[MIT](LICENSE) © 2026 Anoryx Tech Solutions

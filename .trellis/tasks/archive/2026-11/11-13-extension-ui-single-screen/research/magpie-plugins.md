[![](/img/magpie-small.svg)magpie Docs](/)

[Home](/)
[Get started](/docs/start)
[Intent routing](/docs/intent)
[Plugins](/docs/plugins)
[Remote magpie](/docs/remote)
[Docker](/docs/docker)
[Privacy](/docs/privacy)
[Privacy masking](/docs/masking)
[MCP router](/docs/mcp-router)
[Library](/docs/library)
[Models in Claude Code](/docs/claude-code-models)
[Models in Codex](/docs/codex-models)
[Models in Gemini CLI](/docs/gemini-cli-models)
[Subscriptions in any agent](/docs/subscriptions)
[Local models](/docs/local-models)
[Models in OpenCode](/docs/opencode-models)
[magpie vs CC Switch vs CCR](/docs/alternatives)
[Add to magpie](/docs/import)
[Integrate](/docs/integrate)
[Releases](https://github.com/yetone/magpie-releases/releases)

[English](/docs/plugins)
[中文](/docs/zh/plugins)
[日本語](/docs/ja/plugins)



[Download](/#get)

Plugins

[Overview](#overview)
[A plugin in five minutes](#quick)
[How magpie runs plugins](#run)
[The package](#package)
[Provider and models](#provider)
[Signing in](#signin)
[Requests](#requests)
[Sign-in state](#signin-state)
[Usage](#usage)
[Check-in](#checkin)
[Model load](#load)
[What a plugin is given](#input)
[Provider ids](#ids)
[Testing](#test)
[Publishing and listing](#publish)
[Async gateway request hooks](#gateway-request)
[Gateway middleware](#middleware)
[Tools for every agent](#tools)
[Agent plugins](#agents)
[Pages in the window](#pages)
[pi packages](#pi)
[The host protocol](#protocol)
[FAQ](#faq)

Docs · Plugins

Writing a plugin
================

A plugin signs in to a service and makes its requests. magpie turns it into a provider that every agent can use, with several accounts, failover, usage and the rest. magpie runs [OpenCode’s provider plugins](https://opencode.ai/docs/plugins/), so a plugin written for OpenCode works here unchanged, and it runs [pi](https://github.com/earendil-works/pi)’s packages that register a provider too (see [pi packages](#pi)). This page covers what a plugin author needs: the hooks magpie calls, what it does with their answers, and how to test, publish and list a plugin.

**In one paragraph.** A plugin is an npm package, a git repository or a folder. Its module exports an async function in OpenCode’s v1 plugin shape. magpie loads every plugin into one [Bun](https://bun.sh) process, the *plugin host*. The function returns hooks:

* `config` declares the provider and its default models.
* `auth` gives the sign-in methods, plus a `loader` whose `fetch` makes each request.
* `provider.models` lists the models one account has.
* `auth.usage` says how much of the plan is used. It is magpie’s own hook, and OpenCode ignores it.
* `auth.refresh` renews an account’s token before it runs out, once at a time. It is magpie’s own hook too.
* `auth.checkin` presses the vendor’s daily check-in for an account. It is magpie’s own hook too.

An agent can send in any API. The gateway translates the request into the API the model speaks (chat completions, Responses, Anthropic Messages or Gemini), hands it to the plugin’s `fetch`, and streams the answer back.

[A plugin in five minutes](#quick)
----------------------------------

This example signs in to Acme, a made-up coding plan. Acme takes an API key, has an OpenAI-compatible endpoint, and reports each account’s models and usage. A real plugin differs mainly in how it signs in and signs its requests. This whole example was run against magpie v0.1.676 and a local stand-in for Acme’s API.

package.json
Copy

```
{
  "name": "opencode-acme-auth",
  "version": "0.1.0",
  "description": "OpenCode provider plugin: Acme Coding Plan",
  "type": "module",
  "main": "./index.mjs",
  "files": ["index.mjs", "README.md"],
  "keywords": ["opencode", "opencode-plugin", "acme"],
  "license": "MIT",
  "magpie": { "maxConcurrency": 4 }
}
```

index.mjs
Copy

```
const PROVIDER = "acme"
const BASE = "https://api.acme.example/v1"

export const AcmeAuthPlugin = async ({ client }) => ({
  // the provider and the models it has before anyone signs in
  config: async (cfg) => {
    cfg.provider ??= {}
    cfg.provider[PROVIDER] ??= {
      name: "Acme",
      npm: "@ai-sdk/openai-compatible", // chat completions
      api: BASE,
      models: {
        "acme-coder": { name: "Acme Coder", limit: { context: 200000, output: 32000 }, tool_call: true },
      },
    }
  },

  auth: {
    provider: PROVIDER,
    methods: [{ type: "api", label: "Acme API key", placeholder: "acme-…" }],
    // what every request of this account is sent with
    async loader(getAuth) {
      const auth = await getAuth()
      if (auth?.type !== "api") return {}
      return {
        baseURL: BASE,
        async fetch(input, init) {
          const headers = new Headers(init?.headers)
          headers.set("authorization", `Bearer ${auth.key}`)
          headers.set("x-acme-client", "opencode-acme-auth/0.1.0")
          return fetch(input, { ...init, headers })
        },
      }
    },
    // magpie's own hook: how much of the plan is used
    async usage(getAuth) {
      const auth = await getAuth()
      const res = await fetch(`${BASE}/usage`, { headers: { authorization: `Bearer ${auth.key}` } })
      if (!res.ok) return { error: `Acme answered ${res.status}`, windows: [] }
      const u = await res.json()
      return {
        plan: u.plan,
        windows: [{ name: "5 hours", used: u.percent, resetsAt: u.resets_at, span: 5 * 3600 }],
      }
    },
  },

  // the models this account has, asked of Acme
  provider: {
    id: PROVIDER,
    async models(provider, { auth } = {}) {
      if (auth?.type !== "api") return provider.models
      const res = await fetch(`${BASE}/models`, { headers: { authorization: `Bearer ${auth.key}` } })
      if (!res.ok) return provider.models // magpie keeps the list it had
      const { data } = await res.json()
      const base = provider.models["acme-coder"]
      return Object.fromEntries(data.map((m) => [m.id, { ...base, id: m.id, name: m.name ?? m.id }]))
    },
  },
})
```

Add the folder to magpie, sign in, and try it:

Terminal
Copy

```
magpie plugin add ./opencode-acme-auth   # a folder is loaded where it is; nothing is installed
magpie plugin login acme                 # asks for the key
magpie plugin                            # acme (Acme, 2 models)  signed in
magpie provider test acme                # ✓ chat  7 ms · acme-coder
magpie quota                             # acme · Pro · 5h 37% ↻59m
```

Agents now reach its models as `acme/acme-coder`, the same way as any other provider’s. In the app, open Plugins, click Add a plugin and give it the folder. Then sign in from the provider’s row.

**Try it in a sandbox.** A plugin you are writing should never touch your real magpie. Run magpie with a `HOME` of its own, as [Testing](#test) shows.

[How magpie runs plugins](#run)
-------------------------------

* **Bun.** magpie downloads Bun the first time a plugin is added, and runs every plugin on it. Bun runs TypeScript as is, so an entry can be `index.ts`.
* **One host process.** Every plugin that is on loads into one Bun process, started the first time one is needed. magpie and the host talk over stdin and stdout, one JSON message a line. Anything a plugin prints, `console.log` and `process.stdout` included, is sent to stderr. magpie logs it as `plugin: …`.
* **Installing.**
  + An npm package is installed with `bun add`, with its install scripts left unrun, as OpenCode installs plugins. A dependency that needs a `postinstall` build won’t work.
  + Packages come from the npm registry you already use: the `registry=` in your `~/.npmrc`, `install.registry` in `~/.bunfig.toml`, or `NPM_CONFIG_REGISTRY` / `BUN_CONFIG_REGISTRY` in your shell, before the Mirrors in China switch. A token your `.npmrc` keeps for that registry is sent to it alone. To use another, change npm registry on Plugins → Discover, or run `magpie plugin registry <url>` (`default` goes back).
  + A git repository is fetched by Bun: `github:owner/repo[#ref]`, `git+https://…` or `owner/repo`.
  + A path to a folder or file is loaded where it is.
* **Restarts.** Adding, removing, updating or turning a plugin on or off restarts the host. A reply still streaming through the old host finishes first. Each `magpie` command in a terminal starts a host of its own, so it always loads a folder plugin as it is now. In the app, turn the plugin off and on to load your edits.
* **Proxy.** Every fetch a plugin makes for a provider or an account goes through the proxy the user set for that provider or account. Otherwise it goes through magpie’s own proxy, unless the setting is *direct*. Loopback addresses never go through a proxy. A fetch that passes its own `proxy` option is left alone.
* **Updates.**
  + The community’s packages (`@magpie-community/*`) update by themselves a little after magpie starts, then every hour.
  + Any other package with a newer version shows a dot on Plugins, and in the sidebar Installed reads “1 update”. Plugins then opens on Installed, which names the plugins with a newer version at the top beside Update all; the user updates them with a click or `magpie plugin update`.
  + A spec pinned to a version (`name@1.2.3`) stays on it until the user updates it: Update to …, Update all and `magpie plugin update` install the newest version and unpin it.
  + A git repository has no version to compare. It shows an update when its branch or tag (the default branch without `#ref`) is at another commit than the one Bun installed: GitHub is asked through its API, any other host with `git ls-remote`, at most every ten minutes, and the hourly check asks again. A spec pinned to a commit never has one. The row shows the commit installed.

What magpie keeps, in its config folder (`~/.config/magpie`, or `$XDG_CONFIG_HOME/magpie`):

| File | What it holds |
| --- | --- |
| `plugins.json` | The plugins added: `{"plugins": [{"spec", "off"?, "options"?}], "config"?}`. `options` is the plugin’s second argument, as OpenCode’s `["name", {…}]` gives it. `config` is the OpenCode config the plugins are handed. |
| `plugins/` | The installed npm and git packages, a Bun project of their own. |
| `plugin-auth.json` | The sign-ins (mode 600), in the same shape as OpenCode’s `auth.json`, so a sign-in can be moved between the two. |
| `plugin-providers.json` | The providers and models the plugins listed last, so magpie can start without asking them. |

[The package](#package)
-----------------------

### Where magpie loads it from

magpie looks for the server side of a plugin in the same places OpenCode does, and loads the first file that exports a plugin:

1. `exports["./server"]`, then `main`, then `exports["."]` (or `exports` when it is a string), in `package.json`.
2. Otherwise `index.ts`, `index.tsx`, `index.js`, `index.mjs` or `index.cjs`.

A path to a single file loads that file.

### What the module exports

* `export default { id, server }` (OpenCode v1): `server` is the plugin.
* Otherwise, **every function the module exports** is called as a plugin, as is every exported `{ server }` object.

So don’t export helper functions from the entry file. Put what your tests need on an object instead, as the community plugins do with `export const _internal = { … }`.

### The function

Shape

```
async (input, options) => hooks
// input:   { client, project, directory, worktree, serverUrl, $, experimental_workspace }
// options: the entry's "options" in plugins.json, else undefined
// hooks:   { config?, auth?, provider?, "chat.headers"? }
```

A plugin may return more than one provider by exporting more than one function. Each one’s hooks are separate. When two plugins have an `auth` hook for the same provider, the one loaded last wins, as in OpenCode.

### magpie’s fields in package.json

OpenCode ignores the `magpie` object, so these are safe to add to an OpenCode plugin.

| Field | Meaning |
| --- | --- |
| `magpie.icon` | The plugin’s picture, on its card in Discover (read from npm, or from the repository for one on GitHub) and its row in Installed, and the picture of each of its providers that doesn’t give its own: an `https://` URL or a `data:image/…` URI, at most 1 MB. SVG, PNG and the like. |
| `magpie.name` | The plugin’s name on its row in Installed, and on its sidebar tab when its page gives no title, for a plugin the community’s list doesn’t name (the list’s name wins). The package’s npm name has to be ASCII, so a name like 华为云 HUAWEI goes here. One line, at most 80 bytes; anything else is ignored. It is never shown as reviewed, and never used to find a plugin by name. A repository tagged `magpie-plugin` shows it on its card under Discover → Unofficial, on GitHub too, in place of the repository’s name. |
| `magpie.summary` | Its card’s line under Discover → Unofficial, on GitHub, by language: `{ "en": "…", "zh": "…" }`, in the window’s language (zh-TW reads `zh`), else English, else GitHub’s description. One line of at most 300 bytes a language; anything else is ignored. A card showing a name or summary of the package’s own says “Its own words”: nobody reviewed them. |
| `magpie.maxConcurrency` | How many requests each account takes at once, a whole number from 1 to 1000. A limit the user sets on the provider wins over it. |

The same fields can be set on the `auth` hook (`auth.icon`, `auth.maxConcurrency`), where they win over `package.json`. A plugin that signs in to several providers can give each its own `auth.icon` and keep `magpie.icon` for the plugin itself.

[Provider and models](#provider)
--------------------------------

### Declaring the provider

The provider’s id is `auth.provider`. If [models.dev](https://models.dev) lists that id, magpie starts from its entry, as OpenCode does. Otherwise, declare the provider in a `config` hook. Use `??=`, so a provider the user configured in `plugins.json` isn’t written over:

config hook

```
config: async (cfg) => {
  cfg.provider ??= {}
  cfg.provider["acme"] ??= {
    name: "Acme",
    npm: "@ai-sdk/anthropic",          // the API its models speak (table below)
    api: "https://api.acme.example/v1", // where requests go, unless the loader says otherwise
    models: {
      "acme-large": {
        name: "Acme Large",
        id: "acme-large-2026-09",          // the id the API takes, when it isn't the key
        limit: { context: 400000, output: 64000 },
        reasoning: true,
        tool_call: true,
        modalities: { input: ["text", "image"] },
        cost: { input: 3, output: 15, cache_read: 0.3 }, // US$ per million tokens; leave out for a plan
        variants: { low: {}, medium: {}, high: {} },        // reasoning levels
      },
    },
  }
}
```

A model can also say `provider: { npm, api }` to use another API or address than the provider’s, `headers`, `options`, and `disabled: true` to hide it.

### In front of a vendor magpie knows

When the provider’s `api` is the API of a vendor magpie has a preset for (`https://api.mistral.ai/v1`, `https://api.deepseek.com/v1`, `https://openrouter.ai/api/v1`, …), magpie shapes requests to your provider as it does for that vendor before they reach your `fetch`: Mistral’s thinking parts in place of `reasoning_content`, DeepSeek’s and xAI’s schema rules, OpenRouter’s free pool, and the rest. There is nothing to add; the base URL you already give is what it reads, even when your loader’s `baseURL` sends elsewhere. A base on no preset’s host, on `localhost` or on your network gets no vendor’s handling.

### An upstream that searches the web

When your plugin sits in front of Anthropic’s or OpenAI’s own API, which runs the hosted web search tool itself, set `searches: true` on the provider in the `config` hook. A client’s web search (Claude Code’s WebSearch, Codex’s `web_search`) then reaches your `fetch` as it was sent, on the provider’s Anthropic or Responses models, rather than going through magpie’s own search. Its Chat models are unaffected. magpie doesn’t search with it for other models by itself, but it can be named as the searcher in Settings.

### A decision API (System One)

A plugin can serve TypeSafe’s System One API for its provider, so its models can be a [routing group’s classifier](/docs/intent). Set `decide: true` on the provider in the `config` hook, and `decides: true` on each model that answers questions rather than a conversation, in the `config` hook or on the `models` hook’s list. magpie then posts each question as `POST {baseURL}/systemone` through your loader’s `fetch`, with the account’s sign-in, as it sends any other request. The body is `{"model", "questions", "state"}`; answer `{"model", "answers": {"<question>": {"choice", "score", "confidence"}}}`.

A marked model, and one named `jev-*`, is offered as a classifier and kept from agents: a chat request to it is refused. Without `decide: true` on the provider, `decides` is ignored and every model stays one to chat with.

### The API a model speaks

The AI SDK package named by `npm`, on the model or on the provider, decides the API. That decides the shape of the request your `fetch` receives. Whatever the agent sent, magpie’s gateway has already translated it:

| npm | API | Path after the base |
| --- | --- | --- |
| `@ai-sdk/anthropic`, `@ai-sdk/google-vertex/anthropic` | Anthropic Messages | `/messages` |
| `@ai-sdk/openai`, `@ai-sdk/azure` | OpenAI Responses | `/responses` |
| `@ai-sdk/google` | Gemini | `/models/<id>:streamGenerateContent?alt=sse` |
| `@ai-sdk/github-copilot` | Responses for GPT-5 and later (not gpt-5-mini), chat completions for the rest | `/responses` or `/chat/completions` |
| anything else (`@ai-sdk/openai-compatible`, `xai`, `groq`, `deepseek`, …) | Chat completions | `/chat/completions` |

The base is chosen in this order:

1. the loader’s `baseURL`;
2. the model’s `provider.api`;
3. the provider’s `api`;
4. the AI SDK package’s own default (`https://api.anthropic.com/v1`, `https://api.openai.com/v1`, …).

The body’s `model` is the model’s API id: its `id`, else its key.

### Each account’s models

When the models depend on the account, add a `provider` hook:

provider hook

```
provider: {
  id: "acme",
  async models(provider, { auth }) {
    // provider.models: what models.dev and the config hook give, keyed by id
    // auth: this account's sign-in, as plugin-auth.json keeps it
    return { "acme-large": { ...provider.models["acme-large"], name: "Acme Large" } }
  },
}
```

* magpie calls it once for each account, in that account’s scope and through its proxy. Each account serves only the models listed for it, so an account on a smaller plan isn’t sent a model it doesn’t have.
* A model is OpenCode’s `Model`:
  + `id`, `name`;
  + `api: {id, url, npm}`;
  + `limit: {context, input?, output}`;
  + `capabilities: {reasoning, toolcall, attachment, input: {text, image, …}}`;
  + `cost: {input, output, cache: {read, write}}`;
  + `variants`, `release_date`, `status`.Spreading a model from `provider.models` and changing a few fields is the easy way. A model whose `status` is `"deprecated"` isn’t shown.
* magpie also reads these fields on a model, which OpenCode ignores:
  + `free: true`: the plan serves it at no cost to its allowance. Only this flag makes a model free, and magpie never reads it from `rate`: set it from the vendor’s own word (its list marks the model free, or prices it at $0), not from a rate you worked out.
  + `rate`: the credits a request costs, as a multiple, given as a number (`0.5`) or as the vendor writes it (`"x0.5"`). `0` reads as no rate given, not as free.
  + `rateWas`: the rate before a discount that is running now.Model pickers show them.
* `serviceTiers`, on a model the `models` hook gives: the service tiers its vendor serves it at, as ids, such as `["priority", "ultrafast"]`. Codex is offered them in its model list (`priority` as Fast), and a Chat or Responses request that asks for one of them reaches your `fetch` with its `service_tier`. A tier the model doesn’t list isn’t sent where magpie translates the request.
* The keys of `variants` become the model’s reasoning levels when it reasons.

### When the vendor can’t be reached

magpie keeps the list it already had, as it does for a built-in subscription whose list couldn’t be fetched, when the hook does any of these:

* returns `provider.models` unchanged after a fetch that failed;
* throws;
* returns a list of its own with `list[Symbol.for("magpie.fellBack")] = true`.

If what failed was the sign-in, throw an error with `signIn: "expired"` on it. The account is then marked as needing a new sign-in (see [Sign-in state](#signin-state)).

[Signing in](#signin)
---------------------

The `auth` hook is `{ provider, methods, loader, usage?, refresh?, refreshLead?, checkin?, icon?, maxConcurrency? }`. Each method is a way to sign in that the user can pick. In the app the methods are buttons; in a terminal, `magpie plugin login <id> [<method>]` asks which one.

### An API key

api method

```
{ type: "api", label: "Acme API key", placeholder: "acme-…" }
```

* `label` titles the key’s field. A label that only says “API key” is shown as “Acme API key”.
* `placeholder` is magpie’s own field, a hint inside the field.
* Without an `authorize` function, the key is saved as is: `{type: "api", key, metadata?}`. Answers to `prompts` go in `metadata`.
* With `authorize(inputs)`, the plugin checks or exchanges the key itself. It returns `{type: "success", key, metadata?}` or `{type: "failed", error?}`.

### A browser or device sign-in

oauth method

```
{
  type: "oauth",
  label: "Sign in with Acme",
  async authorize(inputs) {
    const d = await startDeviceCode()
    return {
      url: d.verification_uri,                    // magpie opens it
      instructions: `Enter the code ${d.user_code}`, // and shows this
      method: "auto",                              // "auto": callback() resolves on its own
      async callback() {                           // "code": callback(code), the code the user pastes
        const t = await pollForToken(d)
        if (!t) return { type: "failed", error: "The code expired" }
        return { type: "success", refresh: t.refresh_token, access: t.access_token,
                 expires: Date.now() + t.expires_in * 1000, accountId: t.email }
      },
    }
  },
}
```

* A success with `refresh` is saved as `{type: "oauth", refresh, access, expires, …}`, with every other field you return kept beside them (`accountId`, `enterpriseUrl`, your own).
* A success with `key` is saved as an API key.
* `provider: "other-id"` on the result saves the sign-in to another provider the plugin signs in to.
* `error` on a failure is magpie’s own field: the user sees why (up to 500 characters). Without it, they see only that the sign-in failed.
* When `authorize` can’t start the sign-in, throw, or return `{type: "failed", error}` with no `callback`: the user sees that reason.
* A sign-in the user cancels, or that times out, is over: whatever `callback` returns after it is dropped, and the fetches it makes for it fail. magpie also passes the sign-in’s `AbortSignal` as `callback(code, { signal })` (and `authorize(inputs, { signal })`), so a callback that waits a long time can stop when it aborts.
* `inputs` is passed only to a method with `prompts`. A method without prompts gets `undefined`, as OpenCode’s TUI calls it. An empty object is how OpenCode’s CLI calls, and some plugins then ask on the terminal.

### Questions before signing in

A method’s `prompts` are asked in order before `authorize`, each only when its condition holds:

prompts

```
prompts: [
  { type: "select", key: "region", message: "Region",
    options: [{ label: "Global", value: "global" }, { label: "China", value: "cn", hint: "acme.cn" }] },
  { type: "text", key: "team", message: "Team id", placeholder: "t-…",
    when: { key: "region", op: "eq", value: "global" },        // or condition: (inputs) => boolean
    validate: (v) => (/^t-/.test(v) ? undefined : "Starts with t-") },
]
```

A `type: "password"` question is a `text` one typed unseen: a masked field in the app, and no echo in `magpie plugin login` on a terminal. Use it for a token or a personal access token. It is magpie’s own type: OpenCode’s are `text` and `select`.

### Accounts

* **Where they are kept.** A provider can be signed in to more than once. The first account is kept under the provider’s id, as OpenCode keeps it. Others are kept under `id#xxxxxx`.
* **How the user tells them apart.** magpie names an account by `accountId`, else `metadata.email`, else `email`. Save one of them, an email where you have one.
* **Signing in again.** A new sign-in replaces an existing account when both have the same `accountId`. Where both also have a `uid` (the vendor’s own id, for vendors whose names can repeat), it must match too. Without an id, the same secret matches. Otherwise the sign-in becomes a new account.
* **Scope.** Every call magpie makes for an account runs in that account’s scope:
  + `getAuth()` returns that account.
  + `client.auth.set({ path: { id: "acme" }, body })` saves to that account.So keep per-account state by the auth you were given, not in a module variable keyed by the provider.
* **Refreshing.** Give `auth.refresh` and magpie renews the token for you (see [Renewing a sign-in](#renew)). Otherwise, when a token runs out, refresh it in `fetch` and save the whole object with `client.auth.set`. What you give replaces what was kept; nothing is merged.

### Renewing a sign-in

From magpie 0.1.684, a plugin can leave renewing its tokens to magpie with `auth.refresh`, magpie’s own hook (OpenCode ignores it):

auth hook

```
auth: {
  provider: "acme",
  methods: [ … ],
  // optional: how long before expires to renew (ms), 5 minutes by default
  refreshLead: 5 * 60 * 1000,
  async refresh(auth, provider) {  // auth is the account's saved sign-in
    const t = await exchange(auth.refresh)
    if (t.error === "invalid_grant")
      throw Object.assign(new Error("Acme refused the sign-in"), { signIn: "expired" })
    return { access: t.access_token, refresh: t.refresh_token ?? auth.refresh,
             expires: Date.now() + t.expires_in * 1000 }
  },
  loader: async (getAuth) => ({ … }),  // getAuth() already gives the renewed token
}
```

* **When it runs.** For an OAuth account whose `expires` is less than `refreshLead` away, before the account’s loader, `provider.models`, `auth.usage` or a request. An account with `expires` 0 or none is never renewed.
* **Once at a time.** Requests that find the token due wait for one renewal, so a vendor that spends a refresh token once never sees it twice. They wait up to 15 seconds; a renewal that takes longer is still saved when it ends.
* **What is saved.** The fields you return are kept over the account’s old ones (merged, unlike `client.auth.set`), and the account’s mark is cleared. Return nothing when there is nothing to renew.
* **When it fails.** The account is left as it was and the request goes on with the old token, for the vendor’s answer to tell. An error with `signIn: "expired"` marks the account (see [Sign-in state](#signin-state)), and magpie doesn’t try again until it is signed in again. Any other error is tried again after 30 seconds.
* **OpenCode and older magpie.** They ignore the hook. Keep the check in your `fetch` too if the plugin runs there: under magpie it finds the token fresh and does nothing.

[Requests](#requests)
---------------------

`loader(getAuth, provider)` runs once per account and is run again after its sign-in changes. It returns what OpenCode would give the AI SDK:

| Field | What magpie does with it |
| --- | --- |
| `baseURL` | Where requests go, ahead of the model’s and provider’s `api`. |
| `apiKey` | Sent as the AI SDK package sends it: `x-api-key` for Anthropic, `x-goog-api-key` for Google, `Authorization: Bearer` otherwise. For an API-key sign-in, it defaults to the saved key. |
| `headers` | Added to every request. |
| `fetch` | Makes the request. Without it, magpie’s host uses the standard `fetch`. |

The request your `fetch(input, init)` receives:

* `input` is the full URL: the base plus the path for the model’s API.
* `init.method` is usually `POST`.
* `init.headers` are set in this order, each overriding the one before:
  1. the key header from `apiKey`;
  2. the loader’s `headers`;
  3. the gateway’s request headers;
  4. what `chat.headers` hooks add.
* `init.body` is the JSON string in that API’s shape (bytes when it isn’t UTF-8 text). `model` in it is the API id, and `stream` is whatever the agent asked for.
* `init.signal` aborts when the agent gives up on the request.

Return a `Response`. Its status, headers and body go back as they come, streamed chunk by chunk. If you rewrite a streaming body, drop `content-length` and `content-encoding` from the headers.

### Failures and failover

* A non-2xx response is the vendor’s answer. The gateway handles it as it would any provider’s: a rate limit or a server error moves the request to the next account or model, and a 401 marks the account (see [Sign-in state](#signin-state)). Answer a model the account may not use with 403 or 404 and the vendor’s words, not 401: the gateway reads that as the model refused, not the sign-in.
* A thrown error fails the request, and failover moves on.
* Answer in the API’s own error shape where you can, so the agent shows the vendor’s message.

### chat.headers

OpenCode’s `chat.headers` hook runs for every request. Its `input.sessionID` is magpie’s conversation id, which stays the same across a conversation’s turns. Use it for a vendor’s session or cache header:

chat.headers

```
"chat.headers": async (input, output) => {
  if (input.model.providerID === "acme") output.headers["x-acme-session"] = input.sessionID
}
```

[Sign-in state](#signin-state)
------------------------------

magpie marks an account whose sign-in the vendor refused. It shows the mark to the user and stops sending to the account until it works again. By default a 401 marks the account and a success clears the mark. A plugin can say more precisely what an answer means with the `X-Magpie-Sign-In` response header, which magpie removes before the answer goes on:

| Value | Meaning |
| --- | --- |
| `expired` | The sign-in was refused, whatever the status (a vendor that answers 403 or 502 for it). |
| `kept` | Leave the account as it is (a 401 that is about something else). |
| `renewed` | The sign-in renewed: clear the mark, whatever the request then met. |

A 401 without the header whose body says only that the model isn’t served (“model … not available”, `model_not_found`, “模型不支持”) and nothing of a token, key, session or sign-in is read as `kept`. Before, it marked every account the request failed over to as needing a new sign-in. A 401 that names the model and also says the token is invalid still marks the account.

From `fetch` or `provider.models`, throw an error with `signIn: "expired"` on it for the same effect:

index.mjs

```
throw Object.assign(new Error("Acme refused the sign-in; sign in again"), { signIn: "expired" })
```

[Usage](#usage)
---------------

`auth.usage(getAuth, provider)` is magpie’s own hook. It says how much of an account’s allowance is used. It runs in the account’s scope, so a token it refreshes is saved to that account. magpie shows its answer on the account in Providers, in `magpie quota` and at `GET /v1/magpie/quotas` on the gateway. Every field is optional:

usage result

```
{
  plan: "Pro",
  user: "ada@example.com",     // the account as the vendor names it
  until: "2026-11-01T00:00:00Z", // the plan's end
  renew: "auto",                // or "off"
  balance: "$12.40",
  error: "",                    // shown in place of the windows
  windows: [{
    name: "5 hours",
    used: 37,                   // percent; past 100 when overspent
    resetsAt: "2026-10-03T18:00:00Z", // or resetSecs: 3600
    span: 18000,                // seconds the window runs
    display: "370 / 1000 credits",
    amount: 370, limit: 1000, unit: "credits", // its own count, when it counts amounts
    model: "opus",              // counts only models whose ids hold this word
    models: [], notModels: [],  // or exactly these ids, or all but these
    family: "Gemini", pool: "Gemini", // a model's family, and the group sharing its allowance: the card shows a pool's own windows (no model, no family) in place of its models'
    aside: false,               // true: using it up doesn't stop the account
    runsOutAt: "2026-10-05T00:00:00Z", runsOut: 120, // when the soonest credits left are lost, and how many
    balance: 6291,              // a prepaid wallet: what is left, in unit; no used or limit
  }],
  resets: { count: 2, until: "…", byWindow: false, fiveHour: 1, weekly: 1 }, // resets the account may spend
  signIn: "kept",               // as X-Magpie-Sign-In
}
```

Times are ISO strings or epoch numbers, in seconds or in milliseconds. Without `signIn`, an `error` that says to sign in again marks the account, and a clean read clears the mark.

Leave `used` out when the vendor doesn’t tell it, never send 0 for “not known”. Left out with `amount` and `limit`, the share is theirs (370 of 1000 is 37 used). Left out with no count, the window is its `display` alone: routing doesn’t read it, and an account whose windows all say nothing is weighed as one never read, not as the one with the most left. A window with `aside: true` is shown on the account’s card, with its share and count, and in `GET /v1/magpie/quotas`, but routing never reads it: using it up doesn’t stop the account or weigh it against the others, whatever `amount` and `limit` say. Leave `aside` off a window the account really stops at.

[Check-in](#checkin)
--------------------

A vendor that gives credits for a daily check-in can have the plugin press it with `auth.checkin`, magpie’s own hook (OpenCode ignores it). magpie runs it for each signed-in account once a Beijing day while the user has check-in on for the provider, and shows what came of it on the account’s Usage card and in Settings.

auth hook

```
auth: {
  provider: "acme",
  async checkin(getAuth, provider) {
    const auth = await getAuth()
    const r = await claim(auth.access)
    if (r.already) return { outcome: "done" }
    return { outcome: "claimed", credit: r.points, streak: r.days, message: r.text }
  },
}
```

It answers `{ outcome, credit?, streak?, message? }`:

| `outcome` | Meaning |
| --- | --- |
| `claimed` | Checked in now. `credit` is what it gave. |
| `done` | Checked in already today. A vendor that answers 2xx with nothing left to claim is `done`, not `failed`. |
| `ineligible` | The account can’t take part. |
| `inactive` | No check-in is running. |
| `captcha` | The vendor asks for a captcha. Never solve it: the user checks in in the vendor’s own app. |
| `failed` | It didn’t work. magpie asks again later that day. |

`streak` is the days in a row, and `message` is shown as it is. A hook that throws, or answers no outcome above, is `failed`. It runs in the account’s scope, so a token it renews with `client.auth.set` is saved to that account.

[Model load](#load)
-------------------

A vendor that queues requests to a busy model can have the plugin say how busy each model is, with `input.magpie.load(provider, loads)`, magpie’s own (OpenCode has none). `loads` maps a model id to a percent from 0 up, or to `null` to say it isn’t known any more. The plugin calls it whenever it likes, from its own timer: magpie doesn’t ask for it.

plugin

```
export default async (input) => {
  const report = async () => {
    const r = await fetch(`${BASE}/load`).then((r) => r.json()).catch(() => null)
    if (r) input.magpie?.load?.("acme", { "acme-large": r.large, "acme-small": r.small })
  }
  report()
  setInterval(report, 60_000)  // within five minutes, or the load is unknown again
  return { auth: { /* … */ } }
}
```

* **Values.** 100 is as busy as the vendor serves at once; a vendor that queues reports past it (200 is twice that). A number below 0 counts as 0, and one past 10000 as 10000, a sanity cap. Anything else (a string, `NaN`) is dropped. Model ids match whatever their case, and `model@256k` has its model’s load unless reported itself. One call takes up to 1000 models and returns how many it took. A provider that isn’t a string, or a `loads` that isn’t an object, throws a `TypeError`.
* **Freshness.** Each model’s load counts for five minutes from the call that reported it. After that it is unknown, never 0: a plugin that stops calling leaves its models where they were. A model a call doesn’t name keeps its last load until its own five minutes run out.
* **Where it shows.** The provider editor shows it by the model, a small grey number.
* **Routing.** With Settings › Models › Routing › Busy models last set (Off by default; over 50, 70, 80 or 90%, or Custom… for any number from 1 to 9999, such as 150 for a vendor that queues), a model reported busier than that goes behind every other candidate a request could go to, ahead of those resting after a failure. A conversation it answered moves to the one that leads at its next turn; within a turn it stays. A model with no load known keeps its place. The Routing trace says `busy` with the load.

A plugin written for older hosts checks `input.magpie?.load` first, as above.

[What a plugin is given](#input)
--------------------------------

magpie hands a plugin what OpenCode’s `PluginInput` has, as far as it has meaning without an OpenCode server:

| Field | In magpie |
| --- | --- |
| `client.auth.set` / `.remove` | Saves or forgets the sign-in of the account in scope. |
| `client.app.log` | Writes to magpie’s log as `plugin [level]: [service] message`. |
| `client.tui.showToast` | Written to magpie’s log. |
| `client.config.get` | The config after every plugin’s `config` hook. |
| any other `client.*` | Answers `{ data: undefined }`. |
| `directory`, `worktree` | magpie’s config folder, a place to keep files. |
| `project` | `{ id: "magpie", worktree }`. |
| `$` | Bun’s shell. |
| `serverUrl` | A placeholder; no OpenCode server is behind it. |
| `magpie.option`, `.options`, `.load` | magpie’s own: the plugin’s options as the user set them, and [its models’ load](#load). |

The hooks magpie calls are `config`, `auth` (its methods, `loader`, `usage`, `refresh` and `checkin`), `provider.models` and `chat.headers`. A plugin’s other hooks (`tool`, `event`, `chat.params`, …) are not called. The agent runs its own tools.

[Provider ids](#ids)
--------------------

* Agents name a plugin’s model as `<id>/<model>`, where the id is the plugin’s `auth.provider`.
* When the id is taken in magpie, by a built-in subscription, a preset (`google`, `openai`, `anthropic`, …) or `magpie` itself, the plugin’s provider is named `<id>-plugin`. Pick an id that is only yours.
* The community’s plugins for magpie’s deprecated built-in subscriptions are the exception. They use the built-in’s id (`cursor`, `zed`, …) and take it over once the user moves onto the plugin, so agents keep working unchanged.
* When two installed plugins sign in to the same id, such as a published plugin and your own copy of it, one of them serves it: the one picked for it, otherwise the one added last. Both stay in Plugins → Installed, and each row says which one serves the provider. Use for … on the other row, or `magpie plugin use <name> <id>`, makes the pick.

[Testing](#test)
----------------

Run magpie in a sandbox, so your own magpie, its agents and sign-ins are never touched:

Terminal
Copy

```
sb=$(mktemp -d)
m() { env HOME=$sb XDG_CONFIG_HOME=$sb/.config XDG_CACHE_HOME=$sb/.cache MAGPIE_ADDR=127.0.0.1:3499 magpie "$@"; }
m plugin add ./opencode-acme-auth </dev/null
m plugin --json                     # what the plugin lists: methods, accounts, models, load errors
m plugin login acme                 # each method, each prompt
m provider test acme                # one tiny request per API
m provider test acme acme-coder     # or to the models named
m quota                             # the usage hook
m plugin logout acme
```

* A plugin that fails to load says why in `magpie plugin`.
* Hook errors and everything a plugin prints are in the output, as `plugin: …` lines.
* For unit tests, run `bun test` against the functions you put on `_internal`.
* The [community repository](https://github.com/magpie-community/plugins) has a few scripts:
  + `bun scripts/check.mjs` loads each package as magpie does and checks its hooks.
  + `scripts/try.sh <name>` runs it in a sandbox like the one above.

[Publishing and listing](#publish)
----------------------------------

* **npm.** Publish the package as usual. Users add it by name (`magpie plugin add opencode-acme-auth`), by a version (`…@0.2.0`), from git, or from a folder.
* **Search.** The search on Plugins asks npm for `<query> opencode`. It shows a package whose name or keywords hold `opencode` and one of `auth`, `plugin` or `provider`. Keywords like `["opencode", "opencode-plugin", "<vendor>"]` do it. It also asks for `keywords:pi-package <query>` and shows a pi package whose name or keywords mention `auth` or `provider`.
* **README.** A plugin’s page in magpie shows its npm README. Say what it signs in to, how, where the sign-in is kept, and which models it has.
* **The list.** Plugins suggests the plugins in [`registry.json`](https://github.com/magpie-community/plugins/blob/main/registry.json) of the community repository. magpie fetches it at most every six hours and builds in a copy for when it can’t. To be listed, open a pull request adding an entry:

  registry.json

  ```
  { "package": "opencode-acme-auth", "name": "Acme", "icon": "https://acme.example/icon.svg",
    "providers": ["acme"],
    "summary": { "en": "Your Acme Coding Plan.", "zh": "使用你的 Acme Coding Plan。" } }
  ```

  A middleware’s entry has `"kind": "middleware"` and no `providers`; it is listed under Gateway middleware. The other kinds are listed the same way: `"kind": "tools"` under Tools for agents, `"kind": "page"` under Pages and `"kind": "agent"` under Agents. Those sections hold the community’s own packages, whose entries have `"community": true`. A package published from your own repository leaves that out: it isn’t in the sections, the search on Plugins finds it by its name, summary or publisher, and its card shows its npm publisher, not the magpie community badge. `MAGPIE_PLUGIN_MARKET=<url>` points magpie at another list, which is useful to check yours, and `off` keeps to the built-in copy.
* **A GitHub topic.** A repository tagged `magpie-plugin` on GitHub is shown under Plugins → Discover → Unofficial, on GitHub, the most starred first, marked as reviewed by no one. Keep `package.json` at the repository’s root. Published to npm with `repository` naming the repository, it is installed from npm; otherwise from the repository as it stands, so the file it loads must be committed: one whose `dist` is built only to publish is left out. Forks, archived repositories and magpie-community’s own are left out too. magpie asks GitHub at most every ten minutes, so a repository shows within minutes of being tagged. Its card shows the icon `"magpie": { "icon": "…" }` in its `package.json` gives, else a puzzle piece. Its licence is the one GitHub reads from the repository’s `LICENSE` file; when GitHub can’t match the file to a licence (it says `NOASSERTION`, as for MIT’s text with a line added) or there is none, the card shows `package.json`’s `license`. A plugin installed from npm shows `package.json`’s.
* **The community packages.** To contribute one to [magpie-community/plugins](https://github.com/magpie-community/plugins):
  + Put it under `packages/<name>`, named `@magpie-community/opencode-<name>-auth` (a provider) , `@magpie-community/middleware-<name>` (middleware or a routing strategy), `@magpie-community/tools-<name>` (tools), `@magpie-community/page-<name>` (a page) or `@magpie-community/agent-<name>` (an agent), with no runtime dependencies unless one is really needed.
  + Pushing a version bump to `main` publishes it.
  + These packages update by themselves in every magpie.

[Async gateway request hooks](#gateway-request)
-----------------------------------------------

A plugin can await I/O before an agent request is routed, for example to recall project context. Declare `"magpie": { "hooks": "./hooks.js" }` in package.json, or add a `*.hooks.js` / `.mjs` / `.ts` / `.mts` file (Bun runs TypeScript without a build step). Export a named async `onRequest(body, ctx)`. A gateway-only package needs no OpenCode main/exports.

Optional async `onResponse(reply, ctx)` receives a best-effort completion notification after output finishes. It cannot change the reply and never holds the live stream. Client tool declarations and tool loops stay with the client.

Optional async `onSignIn(event, ctx)` hears of a subscription account that has to be signed in again: `event` is `{provider, providerName, account, state, endsAt?}`, `state` `signed-out`, or `ending` for a Claude sign-in within three days of its end. It is told once until the account works again, and carries no token. A hooks file may export only `onSignIn`.

It runs in Bun once per agent request, before the JS gateway middleware, for every provider, Codex's own ChatGPT sign-in included. body is the agent API object. ctx contains `protocol`, `model`, `stream`, `path`, `agent`, `session`, `cwd`, `query`, `options` and `signal`. The query is the latest user text, excluding tool results and images. Missing identity fields are empty; authorization headers are never included.

Return an object to replace the request, or undefined to keep it. A hook that changes the model, streaming, the client's tools or its tool choice is rolled back, as a failure, and gets no `onResponse` for that request. Each hook receives a clone; mutations from failed or undefined hooks are discarded. Successful changes follow enabled plugin order. Each hook defaults to one second; `gatewayTimeoutMs` accepts integers from 100 to 30000 milliseconds; a value outside that range is clamped to the nearer bound. The chain sums budgets, clamped to 2–10 seconds, or takes the longest hook's own timeout when that is longer; host startup is bounded to 11 seconds, and startup plus RPC to the chain budget plus one second (at least 11 seconds). Settings → Plugins offers JSON options and call, latency, failure and outcome diagnostics. `ctx.report(code, bytes)` accepts ready/empty/unbound/unauthorized/unavailable/invalid/skipped and byte counts only. Statistics reset on reload and retain no private text. Use `ctx.signal` with fetch. Errors, invalid returns, timeouts and a host busy starting keep the request. Bun plugins have host privileges; install trusted code.

Install with `magpie plugin add ./my-plugin`; save options with `magpie plugin options my-plugin '&lbrace;"serverUrl":"http://127.0.0.1:8000"&rbrace;'`. On/off and options changes reload the host; source-only edits need a configuration reload. Internal title/classifier requests skip the hook.

[Gateway middleware](#middleware)
---------------------------------

A plugin can also be *gateway middleware*: code that magpie’s gateway runs on every request an agent sends it, before the request is routed, and on the reply on its way back. It can give a model another name, add to the system prompt, turn a request away, change or hide what the model says, or keep its own count of what goes through. It works with every provider, a plugin’s or not.

alias.middleware.js
Copy

```
// alias.middleware.js
export const events = ["message_start"]

export function onRequest(body, ctx) {
  ctx.state.asked = body.model
  if (body.model === "fast") body.model = "deepseek/deepseek-chat"
  if ((ctx.options.blocked ?? []).includes(body.model)) return ctx.reject(403, "not this model")
  return body
}

export function onEvent(ev, ctx) {
  ev.message.model = ctx.state.asked  // the agent sees the name it asked for
  return ev
}
```

shell
Copy

```
magpie plugin add ./alias.middleware.js   # or a package whose package.json has "magpie": { "middleware": "./mw.js" }
```

### [Ready-made middleware](#middleware-community)

The community repository has middleware ready to add, most of it what [New API](https://github.com/QuantumNous/new-api) does for its channels, taking the same JSON. They are under Plugins → Discover → Gateway middleware, and every card there says whether it is a provider or middleware.

| Package | What it does |
| --- | --- |
| [`param-override`](https://github.com/magpie-community/plugins/tree/main/packages/param-override) | New API’s `param_override`: set, delete, move, copy or rewrite fields of the request, for some models or under conditions, or turn a request away. A `param_override` copied from New API works unchanged. |
| [`model-map`](https://github.com/magpie-community/plugins/tree/main/packages/model-map) | New API’s `model_mapping`: send a model under another name, by name or `/pattern/`. Replies name the model the agent asked for. |
| [`system-prompt`](https://github.com/magpie-community/plugins/tree/main/packages/system-prompt) | A system prompt of yours on every request, or only some agents’ or models’, in each API’s own place. A request with its own keeps it unless `override` is on. |
| [`word-guard`](https://github.com/magpie-community/plugins/tree/main/packages/word-guard) | New API’s sensitive-word filter: turn away or mask words and patterns in what users send, and in replies if you like. |
| [`think-tags`](https://github.com/magpie-community/plugins/tree/main/packages/think-tags) | Take a `<think>…</think>` block out of the start of a reply’s text, or put a Chat reply’s `reasoning_content` into it (New API’s `thinking_to_content`). |
| [`antigravity-cloak`](https://github.com/magpie-community/plugins/tree/main/packages/antigravity-cloak) | Breaks up the words Antigravity turns Claude Code’s and the Agent SDK’s system prompts away for, in what it sends Antigravity only. Other providers are sent the prompt as it was. |

shell
Copy

```
magpie plugin add @magpie-community/middleware-model-map
magpie plugin options model-map '{"mapping": {"fast": "deepseek/deepseek-chat"}}'
```

### [Options](#middleware-options)

A middleware reads its settings from `ctx.options`, which are its entry’s `options` in `plugins.json`. Set them in Plugins → Installed with the middleware’s Options button, which edits them as JSON in its row, or with `magpie plugin options <name> '<json>'` (`off` clears them). The name can be the package’s, its spec, or its short name: `model-map` for `@magpie-community/middleware-model-map`. They apply from the next request on. A package can suggest options with `"magpie": { "options": { … } }` in its `package.json`: the editor starts from those when none are set, but a middleware runs with no options until you save some. A key that a provider plugin declares as a switch (its editor’s Plugin options, such as Cursor’s `wire_trace`) is saved as that switch: `magpie plugin options cursor '&lbrace;"wire_trace": true&rbrace;'` turns it on, and `off` puts every switch back to the plugin’s default.

### How it runs

Middleware isn’t run on Bun. It runs inside the gateway’s own process, in [moejs](https://github.com/MoeForge/moejs), a JavaScript engine written in Go, because a reply streams thousands of events and each one waits for it. A hook on one event costs about a microsecond; a round trip to Bun would cost tens. Each middleware is compiled once, and each request gets a runtime of its own, so requests run in parallel and a request’s hooks share `ctx.state`.

* **Declaring it.** `"magpie": { "middleware": "./mw.js" }` in `package.json`, or a single file named `*.middleware.js` (or `.mjs`). A package with no `main` and no `exports` is only middleware, and the plugin host leaves it alone; one with both is a provider plugin and middleware at once.
* **Imports.** Only files inside the plugin, by relative path. There is no `node_modules` here: bundle what you import into the file.
* **What it has.** Standard JavaScript and `console.log` (into magpie’s log, at most 60 lines a minute). There are no timers, no `fetch` and no Node APIs. A hook may be `async`, but there is nothing for it to wait on.
* **Changes.** magpie looks at the files and `plugins.json` once a second, and loads a middleware again when they changed.

### The hooks

Each is a named export or a member of `export default { … }`. Bodies and events are in the agent’s own API (`ctx.protocol`), not the provider’s. Return the object to send on, or nothing to send it on as it was.

| Hook | Is given | Returns |
| --- | --- | --- |
| `onRequest(body, ctx)` | The request body, before routing: a new `model` routes it elsewhere. | The body, or nothing. `ctx.reject(status, message)` turns the request away with that error, in the agent’s API (403 when no status is given). |
| `onAccount(account, ctx)` | The subscription account a try is about to go to, before anything is sent: `account` has `ref`, `provider`, `name`, `kind` (such as `codex` or `claude`) and `model`. `ref` stands for the account without naming it: 32 hex characters, the same on every request and after magpie restarts, and different for each middleware, so a middleware can remember an account without ever being told its email or id. A new plan gives the account a new `ref`. Not called for an API key. `ctx.account` is the same object in the hooks after it for that try. | `{skip: true}` passes the account over for this request: the next account or key is tried, and the account isn’t rested or held against. When every one is passed over, the agent gets the usual error that none is ready, and nothing is sent. Anything else, or nothing, uses the account. |
| `onProvider(body, ctx)` | The request body as it is about to go to one provider; `ctx.provider` has its `id`, `name`, `account` (the subscription’s kind, such as `claude` or `antigravity`; absent for an API key) and `model`. It is called again for each provider a request is tried on, each time with the body `onRequest` left, so a change for one provider reaches no other. | The body, or nothing. The request is routed by now: it can’t be turned away or sent elsewhere. |
| `onEvent(event, ctx)` | Each event of a streamed reply: its `data:` JSON. | The event, nothing, or `null` to leave the event out. |
| `onResponse(body, ctx)` | A reply that isn’t streamed, whole; `ctx.status` is its status. | The body, or nothing. |

`export const events = ["content_block_delta"]` calls `onEvent` only for events of those names (Anthropic Messages and Responses name theirs). Chat Completions and Gemini events have no name, so leave `events` out for them. An event holds a piece of the reply, so a word can be split over two events. A `data: [DONE]` line and comments pass by unseen. A compressed reply passes as it is.

`ctx` has `protocol` (`anthropic`, `chat`, `responses` or `gemini`), `model` and `stream` as the agent asked, `path`, `agent` when magpie knows it, `options` (the plugin’s [options](#middleware-options)) and `state`, an object of the request’s own.

### When a hook fails

A hook has 250 ms for a request, a provider’s try or a whole reply and 50 ms for an event; loading has a second. A hook that throws, runs out of time or returns something else goes on as if it weren’t there: the request or the event is sent as it was. Settings → Plugins shows each middleware’s hooks, how many calls it had, the average time each took and how many failed, with the last error. The hooks see what the agent sent and gets back, before magpie’s redaction on the way out and after it on the way back. magpie’s own requests (thread titles, the router’s classifier, the web searches and image descriptions it makes for an agent’s request) don’t go through middleware.

### [Routings and usage rows](#gateway-points)

The same module can also export `strategies` and `onUsage`. Such a file can be named `*.gateway.js`, and a package can say `"magpie": { "gateway": "./gw.js" }`.

* **Routings.** Each `strategies[name]` is a routing named `<plugin>/<name>` (the package’s short name, or the file’s name without `.gateway.js`), offered in every routing picker of a provider, a pool and a group while the plugin is on. It is a function `(pool, seats, options)`, or an object with `order`, and returns the order to try the seats in, as indexes. Each seat has `key`, `account`, `known`, `learns`, `used`, `soon` (when its windows renew, in ms), `pace`, `weight`, `resting` and `tokens` (what it was sent lately). It has 20 ms; if it throws, takes longer or returns something else, the seats are tried in their listed order. Off, a provider or group routed by it is too.
* **Usage.** `onUsage(row, options)` gets each request’s usage row after it ends: provider, account and key, model, tokens, `ms`, `ttftMs`, status, error type and cost, never a body, prompt or error text. It runs on its own, so a request never waits for it; rows that come while it is busy past a queue are dropped and counted. It has 250 ms.

spread.gateway.js
Copy

```
// spread.gateway.js
export const strategies = {
  "fewest-tokens": (pool, seats) =>
    seats.map((_, i) => i).sort((a, b) =>
      (seats[a].resting - seats[b].resting) || (seats[a].tokens - seats[b].tokens)),
}

let slow = 0

export function onUsage(row, options) {
  if (row.ms > (options.slowMs ?? 30000)) {
    slow++
    console.log(`slow: ${row.provider} ${row.model} ${row.ms} ms (${slow} so far)`)
  }
}
```

shell
Copy

```
magpie plugin add ./spread.gateway.js
magpie group set fast routing=spread/fewest-tokens
```

[Tools for every agent](#tools)
-------------------------------

A plugin can give tools, with OpenCode’s `tool` hook, and magpie offers them to every agent, not only OpenCode: they are an MCP server of magpie’s own at `/mcp/magpie/tools` (Streamable HTTP). Add that address to any agent that takes an MCP server, and its model can call every tool your plugins that are on give. Each is named `<plugin>_<tool>`, the plugin’s short name first: `weather-tools_now` below.

index.js
Copy

```
import { tool } from "@opencode-ai/plugin"

export const WeatherTools = async () => ({
  tool: {
    now: tool({
      description: "The weather now in a city.",
      args: { city: tool.schema.string().describe("A city, e.g. Berlin") },
      async execute({ city }, ctx) {
        const r = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=3`, { signal: ctx.abort })
        return await r.text()  // text; an object is sent as its JSON
      },
    }),
  },
})
```

shell
Copy

```
magpie plugin add ./weather-tools
claude mcp add --transport http magpie-tools http://127.0.0.1:3425/mcp/magpie/tools   # Claude Code; other agents take the same address
```

Settings → Plugins lists each plugin’s tools by these names and copies the server’s address. `args` is a zod shape (`tool.schema` is zod), a zod object or a JSON Schema object. The agent is shown it, and magpie checks a call’s arguments against it before `execute` runs; a wrong argument is answered as an error naming it. `ctx` is OpenCode’s, with `agent` the agent that called. A tool has 55 seconds, and `ctx.abort` fires when they are up.

The built-in plugin Plugin tools serves the server. It stays on while a plugin that is on gives a tool; off, no tool is listed and a call says so. A call made with a gateway key counts against that key’s limits. A tool runs in the plugin host with your rights, as a provider plugin does, and its answer goes only to the agent that called it.

Each plugin that gives tools is also a server of its own in the Library’s MCP tab, named by the plugin’s short name (`search1api`), so you don’t have to add the address by hand. With the [MCP router](mcp-router.html) on, its tools are in the router of every agent the router is given, as `search1api__search`; switch it on or off per agent, or turn single tools off, as with any Library server. Removed, it comes back only when you remove the plugin and add it again.

To keep a plugin for its providers but give its tools to no agent, press Hide from agents on its tools line under Plugins › Installed. Its server is then given to no agent, nor to an app at the router’s address, through updates, the plugin off and on, and restarts. Give to agents gives it back to the agents it had.

[Agent plugins](#agents)
------------------------

A plugin can also add an *agent*: one magpie has no setup of its own for. It says where the agent keeps its model and what else to write there for the agent to use magpie’s gateway. The agent is then on the Agents page like magpie’s own: pick one of magpie’s models in its row and magpie writes it into the agent’s config, with the gateway’s address and a key of the agent’s own; switch it off and everything goes back to how the user had it. The example below adds [Aider](https://aider.chat).

agent.js
Copy

```
// agent.js, named by "magpie": { "agent": "./agent.js" } in package.json
export const agent = {
  id: "aider", name: "Aider", bin: "aider",
  config: "~/.aider.conf.yml",  // the file magpie edits
  model: "model",                 // the key of the model in it
  prefix: "openai/",              // written before magpie's model id
  ua: ["aider", "litellm"],
  notice: "Aider reads its settings when it starts: restart it to use the new model.",
}

export function connect({ gateway, model }) {
  return {
    "openai-api-base": gateway.v1,
    "openai-api-key": gateway.key,
    "show-model-warnings": false,
  }
}
```

shell
Copy

```
magpie plugin add ./agent-aider   # or a single *.agent.js file
```

### The agent export

| Field | What it says |
| --- | --- |
| `id` | Its id, as the Agents page, usage and the CLI name it: lower-case letters, digits, `.`, `_` and `-`. One of magpie’s own agents’ ids (`codex`, `claude`, …) is refused: a plugin adds an agent, it doesn’t replace one. |
| `name` | What the page calls it. The id when left out. |
| `config` | The file magpie edits. `~` and `$VAR` are expanded. It is made when it isn’t there. |
| `format` | `json`, `yaml` or `env`, when the file’s name doesn’t say it (`.json`/`.jsonc`, `.yaml`/`.yml`, `.env`). TOML isn’t supported yet. |
| `model` | The key of the model in the file, as a dotted path for JSON and YAML (`llm.model`). Leave it out for an agent whose model is picked in the agent itself, among the models `connect` writes (Raycast): the row is then a switch with no model picker, and `connect`, which such a plugin must have, is called without `model`. |
| `startup` | For an agent that keeps the model a session starts on in another file than the one `connect` writes, in place of `model`: `config` and `format` of that file, `model` the key of the model in it, and `keys` written beside the model as they are. PiG keeps its providers in `models.json` and its default in `settings.json`: `startup: { config: "~/.pig/agent/settings.json", model: "defaultModel", keys: { defaultProvider: "magpie" } }`. The row then picks the model, and each file is put back as it was. A magpie older than v0.1.3008 reads such a plugin as one with no `model`. |
| `prefix` | Written before magpie’s model id: `openai/` for an agent that reaches OpenAI-compatible endpoints through LiteLLM. The id itself is `<provider>/<model>`, as the gateway takes it. |
| `bin`, `dir` | The command on `PATH` and the folder that say the agent is installed. |
| `ua` | Words of the agent’s User-Agent, to name its requests in Usage when they come without its key. |
| `icon` | A picture for its row: an icon name, an `https://` or `data:` URL. The plugin’s own icon, else a generic one, when left out. |
| `notice` | Said after its model is changed, as for magpie’s own agents. |
| `library` | Where the agent reads what the Library gives: `instructions` (a Markdown file it reads before every conversation), `mcp` (its MCP servers file) with `mcpFormat`, the agent whose file it is shaped like (`alma`, `antigravity`, `claude`, `cline`, `codex`, `commandcode`, `copilot`, `crush`, `cursor`, `devin`, `gemini`, `goose`, `grok`, `hermes`, `kimi`, `omp`, `opencode`, `zed`; `claude` is `{"mcpServers": {…}}`), and `skills` (a folder of `SKILL.md` folders). Each is optional, with `~` and `$VAR` expanded: `library: { instructions: "~/.toy/AGENTS.md", mcp: "~/.toy/mcp.json", mcpFormat: "claude", skills: "~/.toy/skills" }`. Without it the agent is given nothing from the Library, and giving it an item is refused, naming the key its plugin would set. |
| `launch` | For an agent that takes the gateway only from how it is started: `env`, the variables it is started with, each `{key}`, `{url}` or `{v1}` with a path after the address at most, and `model`, the flag that names the model. While it is on one of magpie’s models, magpie puts a function named after its `bin` in the user’s shells (zsh, bash, fish, PowerShell), which runs `magpie <id> run` to start it on the gateway: `launch: { env: { GEMINI_API_KEY: "{key}", GOOGLE_GEMINI_BASE_URL: "{url}" }, model: "--model" }`. Its own model takes the function out. `args` are flags put before the user’s arguments, each `{config}`, the config’s path: `args: { "--settings": "{config}" }`. `plain` are arguments, a subcommand or a flag, that start the agent as it is, never on the gateway: `plain: ["remote-control"]`. |
| `base` | For an agent handed its `config` by `launch.args`, so that the config is magpie’s own file: the agent’s own settings file. `connect` and `own` get it parsed as `base`, the user’s own model is written there, and stepping out takes the config away whole: `base: "~/.gemini/antigravity-cli/settings.json"`. |
| `merge` | For a json `config`: key paths whose object `connect` returns magpie’s members of, written beside the user’s own and taken out alone: `merge: ["customModelsConfig.customModels"]`. |
| `effort`, `wsl`, `aliases` | `effort: true` gives the agent the Effort field; `wsl: true` lists it in WSL distros too; `aliases` are other names `magpie <name>` takes. |

### connect

`connect(input)` returns the other keys to write beside the model, by key path, each with its value; it may be `async`. It is given `gateway` (`url`, `v1` — the URL ending in `/v1` — and `key`, the agent’s own key, which counts its requests under its id), `model` (`id`, `name`, `context`, `output`, `images`, `efforts`, and as `/v1/models` names them `native_endpoints`, the gateway paths a request for it goes on untranslated such as `["/v1/chat/completions"]`, and `pricing`, USD a token as decimal strings: `prompt`, `completion`, `input_cache_read`, `input_cache_write`; each left out when not known, never empty or 0), `models` (every model magpie offers the agent, the same way) and `agent` (`id`, `config`). A plugin without `connect` writes only the model. It is called again when magpie’s models change, so a list it writes stays current.

`own({ config, base, model })`, when exported, gives the agent’s own models for the row’s picker: it gets the config file parsed (`{}` for none), `base` too when the agent has one, and the model the agent is on, and returns a list of `{ value, model, direct }`, `value` what is written as the model, `model` its name at the vendor and `direct` the vendor it goes to (`Google`, `OpenAI`, `Anthropic`). Without it the picker lists the model the agent is on.

### What magpie does with it

* **Writing.** Each key is set in place, the user’s comments and other keys kept. Before the first write, what each key held is kept aside, typed (a number stays a number).
* **The way back.** Picking the agent’s own model again, or switching it off, puts every key back as it was and takes out the keys that weren’t there. The file is never written over whole.
* **Connected or not.** The row says connected while the key that holds magpie’s key still holds it. A key changed by hand afterwards is said in the row, as for magpie’s own agents.
* **How it runs.** As [middleware](#middleware) does: in moejs, in magpie’s own process, with imports inside the plugin only, no Node APIs and `console.log` into magpie’s log. Loading and `connect` each have a second. A plugin whose module doesn’t load, or whose `connect` throws, says why in its row on the Plugins page and writes nothing.
* **The Library.** With `library`, the agent is one of the Library’s agents: its instructions go between magpie’s marker lines in the file, its MCP servers into the file beside the user’s own (whose other fields are kept), and its skills linked or copied into the folder. Taking one off takes away only what magpie wrote there, and what a file held before is kept in magpie’s backups. An `mcpFormat` that isn’t one of the list, or an `mcp` without one, keeps the plugin from loading.
* **Declaring it.** `"magpie": { "agent": "./agent.js" }` in `package.json`, or a single file named `*.agent.js` (or `.mjs`). A package can be a provider, middleware and an agent at once. In the plugin market an agent’s entry has `"kind": "agent"` and is listed under Agents; a community one is named `@magpie-community/agent-<name>`.
* **An agent that needs a runtime.** The agent file stays a moejs module, with no timers and nothing imported from outside the plugin. When the agent needs more (a timer, a file watched, a value carried over into the app’s own config), the package can also have a Bun module as its `main`, run as a provider plugin’s is. It is still an agent plugin: a package that declares `magpie.agent` is listed under Agents, on GitHub too, with a `main` or without, and its row in Installed wears the Agent chip, and the Provider chip only when its module serves a provider.

[Pages in the window](#pages)
-----------------------------

A plugin can add a page of its own to magpie’s window. Once it is on, the page has a tab in the sidebar’s Plugins group, after magpie’s own pages. The page is plain HTML, CSS and JavaScript in the plugin’s folder, and needs no Bun and no build step. The example below shows today’s usage.

package.json
Copy

```
{
  "name": "magpie-usage-glance",
  "version": "0.1.0",
  "magpie": {
    "page": {
      "title": "Usage glance", "file": "page/index.html", "icon": "page/icon.svg",
      "titles": { "zh": "用量速览", "ja": "使用量の概要" }
    },
    "permissions": ["usage:summary"]
  }
}
```

page/index.html
Copy

```
<!doctype html>
<link rel="stylesheet" href="style.css">
<script src="_magpie/bridge.js"></script>   <!-- served beside every page -->
<script src="app.js" defer></script>
<p id="calls">…</p>
```

page/app.js
Copy

```
await magpie.ready                                  // the window's theme, painted
const s = await magpie.read("usage:summary", { period: "today" })
document.getElementById("calls").textContent = `${s.calls} calls`
const opts = await magpie.options.get()            // this plugin's own options
await magpie.options.set({ ...opts, hideCost: true })
```

The Plugins page shows the page, and what it may read, on the plugin’s row before it is turned on. `page.file` and `page.icon` are paths inside the plugin. The page’s files are what sits in `file`’s folder; a path out of it, or a link that leads out, isn’t served. A package can be a page and a provider, middleware or an agent too. A plugin that is only a page doesn’t start the plugin host. `page.titles` (and a panel’s `titles`) names the tab in other languages, by language code (`zh`, `zh-TW`, `ja`, `de`); `title` is used for any other.

What the page leaves unstyled already looks like magpie: the bridge adds a stylesheet for the font, colours, headings, buttons, fields and tables, with no weight (`:where()`), so any rule of the page’s own wins. Use the `--magpie-*` variables to match the window in your own styles.

### What the page can ask

| Field / call | What it gives |
| --- | --- |
| `magpie.ready` | A promise of the window’s theme. It resolves once the window has answered. Until then the page has said nothing to magpie, and a page that doesn’t say it in 10 seconds is shown as not answering. |
| `magpie.theme, magpie.onTheme(fn)` | `{ dark, lang, tokens }`. The bridge also sets `data-theme`, `lang`, `color-scheme` and `--magpie-bg`, `--magpie-fg`, `--magpie-accent` and so on on `<html>`, and again on each change. |
| `magpie.options.get(), .set(o)` | The plugin’s own options in plugins.json, never another plugin’s. `set` takes an object and answers with the options saved. It can be called at most once a second. |
| `magpie.read(name, params)` | A read that `magpie.permissions` declares. Anything else is refused, by the window and again by magpie. `usage:summary` (`period`: `today`, `7d` or `30d`) gives calls, errors, tokens and cost, with the top 20 models. `providers:list` gives each provider’s id and name. No read gives keys, accounts, sign-ins or request bodies. |

### What the page can’t do

* The page runs in a frame sandboxed to scripts alone (`sandbox="allow-scripts"`, and the same in its `Content-Security-Policy`), in an origin of its own. It can’t reach the window, magpie’s cookie or the window’s storage.
* Its policy allows its own files and nothing else: `connect-src 'none'`, so no `fetch`, WebSocket or beacon, and no forms or frames. Scripts must be files (`<script src>`), not inline. Inline styles and `data:` pictures are fine.
* In a sandboxed frame, WebKit (Safari on iPhone and Mac, the Mac and Linux window) may match `'self'`, or a source without a scheme, to nothing: a `fetch` under `connect-src 'self'` is refused. A page your plugin’s service serves, which runs sandboxed too, should name whole sources (`https://…`) in its own policy. magpie adds the service’s address next to each `'self'` in a `Content-Security-Policy` header the service sends through `magpie web`, but not in a `<meta>` tag.
* magpie’s API refuses any request a frame like this one can make (`Origin: null`, a frame or another site’s request), so it is closed to the page even without the policy. Its files are served at `/_magpie/plugin/<token>/`, a token that changes each time magpie starts.
* A page can still send itself to another site, which then holds its frame. That is why reads give nothing secret. Treat what a page can read as public.
* An error the page doesn’t catch shows This page stopped working in its place, with Try again. Its own scripts’ errors reach it as “Script error.”, so look in the window’s console for the rest.

### [Panels in magpie’s own pages](#panels)

A plugin can also put panels into the pages magpie draws itself. Each one is a small page of its own in the plugin’s folder, with the same bridge, reads, options and sandbox as a page. It sits in a card under a heading with its title, as tall as it draws.

package.json
Copy

```
{
  "name": "magpie-provider-notes",
  "version": "0.1.0",
  "magpie": {
    "panels": [
      { "slot": "provider", "file": "ui/notes.html", "title": "Notes" },
      { "slot": "usage", "file": "ui/spend.html", "title": "Top models today" }
    ],
    "permissions": ["usage:summary"]
  }
}
```

| `slot` | Where the panel goes | `magpie.context` |
| --- | --- | --- |
| `agents` | The end of the Agents page | `{}` |
| `usage` | The end of Usage’s Overview | `{}` |
| `settings` | A Plugins tab in Settings, there only while a plugin has a panel in it | `{}` |
| `provider` | Each saved provider’s editor | `{ provider: { id, name } }` |

A plugin has at most 8 panels. A panel’s height follows its `<html>` (up to 2400px), so let the page size itself and don’t give `html` or `body` a fixed height. A panel that throws, or doesn’t answer in 10 seconds, shows {name} stopped working with Try again in its own place; the page around it and the panels beside it go on.

### [Taking a built-in page’s place](#replaces)

A page can take the place of one of magpie’s own: add `"replaces"` to `magpie.page`, one of `sessions`, `library`, `routing` or `usage`. Its tab then stands where the built-in’s was, and links to that page open the plugin’s. When two plugins ask for the same page, the first in the Plugins list takes it and the other is a page of its own. Turn the plugin off and the built-in page is back as it was.

package.json
Copy

```
"page": { "title": "My library", "file": "page/index.html", "replaces": "library" }
```

### [Items in magpie’s menus](#actions)

A plugin with a page can add items to the menus of magpie’s rows: a provider’s (right-click it) and an agent’s (its handle, or right-click). They come after magpie’s own, named in the window’s language like a page’s title. Picking one opens the plugin’s page and tells it which item, and the row’s id and name, nothing else of it. The page handles it with `magpie.onAction`; an item picked before the page gave its handler waits for it.

package.json
Copy

```
"page": { "title": "Balance", "file": "page/index.html" },
"actions": [
  { "id": "check", "menu": "provider", "title": "Check balance", "titles": { "zh": "查余额" } }
]
```

page/app.js
Copy

```
magpie.onAction(({ id, provider }) => {
  // id: "check"; provider: { id, name }
});
```

`menu` is `provider` or `agent`. An `id` is lower-case letters, digits and dashes, up to 40. A plugin has at most 8 items, and an item with no `title` takes its page’s. A plugin without a page adds no items. The Plugins page says which menus a plugin adds to.

[pi packages](#pi)
------------------

magpie also runs [pi](https://github.com/earendil-works/pi)’s packages. A pi extension that registers a provider with `pi.registerProvider` works in magpie as it does in pi, with nothing to change, and is added like any plugin (`magpie plugin add pi-antigravity`).

* **What makes a package pi’s.** Its `package.json` has a `pi` manifest (`"pi": { "extensions": [...] }`), the `pi-package` keyword, or `@earendil-works/pi-coding-agent` (or the older `@mariozechner/pi-coding-agent`) among its `dependencies` or `peerDependencies`. A single file counts when it imports pi.
* **Loading.** magpie installs pi beside the package and loads it with pi’s own loader, in the same plugin host. The providers it registers become magpie providers, with the models pi lists for them (an account’s own list when pi can fetch one). Its commands, tools, renderers and event handlers are left alone.
* **Signing in.** An OAuth login runs as pi runs it: its questions (`onPrompt`) are asked in magpie’s sign-in, its page (`onAuth`) opens in the browser, and `refreshToken` renews it. The dialogs a package shows with `ctx.ui` (`select`, `confirm`, `input`, `editor`) and the terminal components it gives `ctx.ui.custom` are asked as magpie’s questions too. A provider that takes an API key gets a key field. Each sign-in is an account, so a pi provider can have several.
* **pi’s files.** pi’s settings, its `auth.json` (each provider’s first account, as pi keeps it) and the files a package writes are in `pi/` under magpie’s config directory, not the user’s `~/.pi`, unless `PI_CODING_AGENT_DIR` is set. magpie keeps the accounts in `plugin-auth.json`, like any plugin’s.
* **Requests.** A pi provider’s models take Anthropic Messages: the gateway translates what the agent sends, magpie streams it through pi, and the answer keeps its thinking, signatures and tool calls. A vendor error is passed on with its status, so failover works as with any plugin.
* **Ids.** A pi provider’s id follows the same rule as any plugin’s; see [Provider ids](#ids).

[The host protocol](#protocol)
------------------------------

Writing a plugin doesn’t need this section. It is for people working on magpie itself, or debugging the host. magpie writes `{id, method, params}` to the host’s stdin, one per line. The host answers `{id, result}` or `{id, error: {message}}`.

| Method | Does |
| --- | --- |
| `init` | Loads the plugins; runs their `config` hooks. Every other call waits for it. |
| `providers` | Each provider, its methods, accounts and each account’s models. |
| `prompt`, `validate` | A method’s next question; an answer checked. |
| `authorize`, `callback`, `apiKey` | Signing in. |
| `load` | The loader’s options for an account. |
| `fetch` | One request. It streams `{id, event: "head", status, headers}`, then `{id, event: "chunk", data}` (base64), then `{id, result: null}`. `{method: "abort", params: {id}}` cancels it. |
| `usage`, `check` | An account’s usage; an account tried as a request would. |
| `import`, `take`, `signOut`, `reload` | Accounts moved in and out, forgotten, their loaders run again. |

The host also sends events of its own: `log`, `toast`, `auth` (a sign-in saved or refreshed) and `signIn` (an account’s sign-in state, as above). The source is [`internal/plugin/host.js`](https://github.com/yetone/magpie/blob/main/internal/plugin/host.js).

[FAQ](#faq)
-----------

### Does my OpenCode plugin work in magpie unchanged?

Yes, as long as it signs in and makes requests through `auth`, `config`, `provider` and `chat.headers`. What magpie adds (`auth.usage`, `auth.refresh`, `magpie.icon`, `maxConcurrency`, `free`, `rate`, `X-Magpie-Sign-In`) is ignored by OpenCode, so one package serves both.

### Does my pi package work in magpie?

Yes, if it signs in and serves models through `pi.registerProvider`. magpie uses only the providers it registers; see [pi packages](#pi). Give it the `pi-package` keyword so the search finds it.

### Why is my provider called `…-plugin`?

Its id is one magpie already has. See [Provider ids](#ids).

### Some of my helper functions run as plugins.

Every function the entry module exports is called as a plugin. Export only the plugin function, or `export default { id, server }`.

### Can I use npm dependencies?

Yes. They are installed with the plugin, but their install scripts aren’t run. Bun’s `fetch`, `crypto`, `fs` and `$` cover most needs.

### Can my plugin run the vendor’s CLI?

Yes, with Bun’s `$` or `child_process`. Several community plugins sign in through the vendor’s own CLI. Expect it to be missing on some machines, and say how to install it in the error.

### What does a plugin see of the user’s work?

Everything in the requests it makes: the conversation, the tools and their results. Send it only where the user asked it to go, and don’t log it.

### How do I make magpie see my edits?

A `magpie` command in a terminal loads the folder as it is now. In the app, turn the plugin off and on in Plugins.

Questions, or a plugin to share? Ask on [Discord](https://discord.gg/vGSnD3ZKQF), or open an issue in [magpie-community/plugins](https://github.com/magpie-community/plugins).

© 2026 magpie · MIT

[Home](/)
[Intent routing](/docs/intent)
[Plugins](/docs/plugins)
[Remote magpie](/docs/remote)
[Docker](/docs/docker)
[Privacy](/docs/privacy)
[Privacy masking](/docs/masking)
[MCP router](/docs/mcp-router)
[Library](/docs/library)
[Models in Claude Code](/docs/claude-code-models)
[Models in Codex](/docs/codex-models)
[Models in Gemini CLI](/docs/gemini-cli-models)
[Subscriptions in any agent](/docs/subscriptions)
[Local models](/docs/local-models)
[Models in OpenCode](/docs/opencode-models)
[magpie vs CC Switch vs CCR](/docs/alternatives)
[Add to magpie](/docs/import)
[Integrate](/docs/integrate)
[GitHub](https://github.com/yetone/magpie)
[Discord](https://discord.gg/vGSnD3ZKQF)
[Contributors](/docs/contributors)
[Releases](https://github.com/yetone/magpie-releases/releases)
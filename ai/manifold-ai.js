/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MANIFOLD AI — Core Engine
 * z = x · y — Two-Labyrinth Architecture
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Labyrinth A (Encode): User input + file context → prompt assembly
 * Labyrinth B (Decode): LLM output → file materialization + response
 *
 * Helix mapping:
 *   §0 VOID   → System prompt (manifold directive)
 *   §1 POINT  → Single file content
 *   §2 LINE   → File set (directory listing)
 *   §3 WIDTH  → Codebase index (all files + mtime)
 *   §4 PLANE  → Conversation history
 *   §5 VOLUME → Full context assembly
 *   §6 WHOLE  → LLM invocation (z = context · query)
 *
 * Delta caching: files re-read ONLY when mtime changes.
 * No credits. No tollbooth. No limits.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

// ─── Helix Constants ─────────────────────────────────────────────────────
const HELIX = Object.freeze({
  VOID: 0, POINT: 1, LINE: 2, WIDTH: 3, PLANE: 4, VOLUME: 5, WHOLE: 6,
});

// ─── PathExpression ──────────────────────────────────────────────────────
class PathExpression {
  constructor(section, x, y) {
    this.section = section;
    this.x = x;
    this.y = y;
  }
  get z() { return this.x * this.y; }

  static fromValue(section, value) {
    if (value === 0) return new PathExpression(section, 0, 0);
    const sign = value < 0 ? -1 : 1;
    const abs = Math.abs(value);
    const root = Math.sqrt(abs);
    return new PathExpression(section, root, sign * root);
  }
}

// ─── RepresentationTable ─────────────────────────────────────────────────
class RepresentationTable {
  constructor(name) {
    this.name = name;
    this._paths = Object.create(null);
    this._cache = Object.create(null);
    this._dirty = Object.create(null);
    this._strings = Object.create(null);
    this._deltaSet = new Set();
  }

  encode(address, value, section = HELIX.POINT) {
    const path = PathExpression.fromValue(section, value);
    const prev = this._paths[address];
    if (prev && prev.x === path.x && prev.y === path.y) return;
    this._paths[address] = path;
    this._dirty[address] = true;
    this._deltaSet.add(address);
  }

  encodeString(address, value) {
    if (this._strings[address] === value) return;
    this._strings[address] = value;
    this._dirty[address] = true;
    this._deltaSet.add(address);
  }

  decode(address) {
    if (!this._dirty[address] && address in this._cache) return this._cache[address];
    const p = this._paths[address];
    if (!p) return undefined;
    const z = p.z;
    this._cache[address] = z;
    this._dirty[address] = false;
    return z;
  }

  decodeString(address) { return this._strings[address]; }

  has(address) { return address in this._paths || address in this._strings; }

  addresses() { return new Set([...Object.keys(this._paths), ...Object.keys(this._strings)]); }

  get isDirty() { return this._deltaSet.size > 0; }
  flushDeltas() { this._deltaSet = new Set(); }
}

// ─── File Substrate ──────────────────────────────────────────────────────
// The filesystem IS the manifold surface. Files are path expressions.
// Read = decode. Write = encode. mtime = delta cache invalidation.
class FileSubstrate {
  constructor(workspaceRoot) {
    this.root = workspaceRoot;
    // mtime table: delta cache for file freshness
    this.mtimeTable = new RepresentationTable('file.mtime');
    // content table: cached file contents (string labyrinth)
    this.contentTable = new RepresentationTable('file.content');
    // Ignore patterns
    this._ignore = new Set([
      'node_modules', '.git', 'dist', 'build', '.next',
      '__pycache__', '.cache', 'coverage', '.nyc_output',
    ]);
  }

  /** Encode: read file from disk into content table (Labyrinth A) */
  encodeFile(filePath) {
    const abs = path.resolve(this.root, filePath);
    if (!fs.existsSync(abs)) return null;
    const stat = fs.statSync(abs);
    const mtimeMs = stat.mtimeMs;

    // Delta check: skip if mtime unchanged
    const cached = this.mtimeTable.decode(filePath);
    if (cached === mtimeMs) {
      return this.contentTable.decodeString(filePath); // O(1) cache hit
    }

    // mtime changed — re-read (delta invalidation)
    const content = fs.readFileSync(abs, 'utf-8');
    this.mtimeTable.encode(filePath, mtimeMs, HELIX.POINT);
    this.contentTable.encodeString(filePath, content);
    return content;
  }

  /** Decode: write content to disk (Labyrinth B materialization) */
  decodeToFile(filePath, content) {
    const abs = path.resolve(this.root, filePath);
    const dir = path.dirname(abs);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    // Update mtime cache after write
    const stat = fs.statSync(abs);
    this.mtimeTable.encode(filePath, stat.mtimeMs, HELIX.POINT);
    this.contentTable.encodeString(filePath, content);
    return abs;
  }

  /** Index: walk codebase, return set of file paths (finite set, not dimension) */
  indexCodebase(dir = '', depth = 0) {
    if (depth > 8) return []; // dimensional bound
    const abs = path.resolve(this.root, dir);
    if (!fs.existsSync(abs)) return [];
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || this._ignore.has(entry.name)) continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...this.indexCodebase(rel, depth + 1));
      } else {
        files.push(rel);
      }
    }
    return files;
  }
}

// ─── ToolSubstrate — Free API Access ────────────────────────────────────
// Two-labyrinth: encode = build request, decode = materialize result.
// Delta-cached: identical queries return O(1) from cache within TTL.
// No API keys. No accounts. No tollbooths. 100% free public knowledge.
class ToolSubstrate {
  constructor() {
    this._cache = new RepresentationTable('tool.cache');
    this._ttl = new RepresentationTable('tool.ttl');
    this._cacheDurationMs = 10 * 60 * 1000; // 10 min TTL
  }

  /** Generic HTTPS GET — returns string body */
  _fetch(urlStr) {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const mod = url.protocol === 'https:' ? https : http;
      const req = mod.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: { 'User-Agent': 'ManifoldAI/1.0 (local; no-tracking)', 'Accept': 'application/json' },
      }, (res) => {
        // Follow redirects (3xx)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._fetch(res.headers.location).then(resolve).catch(reject);
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
      req.end();
    });
  }

  /** Delta-cached fetch: skip network if cache is fresh */
  async _cachedFetch(cacheKey, urlStr) {
    const now = Date.now();
    const cachedAt = this._ttl.decode(cacheKey);
    if (cachedAt && (now - cachedAt) < this._cacheDurationMs) {
      return this._cache.decodeString(cacheKey); // O(1) cache hit
    }
    const data = await this._fetch(urlStr);
    this._cache.encodeString(cacheKey, data);
    this._ttl.encode(cacheKey, now, HELIX.POINT);
    return data;
  }

  // ═══ ENCYCLOPEDIA ═══════════════════════════════════════════════════

  /** Wikipedia — search or get article summary */
  async wikipedia(query) {
    const enc = encodeURIComponent(query);
    const raw = await this._cachedFetch(`wiki:${query}`, `https://en.wikipedia.org/api/rest_v1/page/summary/${enc}`);
    try {
      const d = JSON.parse(raw);
      return { title: d.title, extract: d.extract, url: d.content_urls?.desktop?.page || '', thumbnail: d.thumbnail?.source || '' };
    } catch { return { error: 'No Wikipedia result', raw: raw.slice(0, 500) }; }
  }

  /** Wikipedia search — find articles matching query */
  async wikipediaSearch(query) {
    const enc = encodeURIComponent(query);
    const raw = await this._cachedFetch(`wikisearch:${query}`, `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc}&format=json&srlimit=5`);
    try {
      const d = JSON.parse(raw);
      return (d.query?.search || []).map(r => ({ title: r.title, snippet: r.snippet.replace(/<[^>]+>/g, ''), pageid: r.pageid }));
    } catch { return []; }
  }

  // ═══ DICTIONARY ═════════════════════════════════════════════════════

  /** Wiktionary — word definitions */
  async wiktionary(word) {
    const enc = encodeURIComponent(word);
    const raw = await this._cachedFetch(`wikt:${word}`, `https://en.wiktionary.org/api/rest_v1/page/definition/${enc}`);
    try {
      const d = JSON.parse(raw);
      const results = [];
      for (const lang of Object.keys(d)) {
        for (const entry of (d[lang] || [])) {
          results.push({ language: lang, partOfSpeech: entry.partOfSpeech, definitions: (entry.definitions || []).map(df => df.definition?.replace(/<[^>]+>/g, '')).slice(0, 3) });
        }
      }
      return results;
    } catch { return [{ error: 'No definition found' }]; }
  }

  /** Free Dictionary API — definitions, phonetics, examples */
  async dictionary(word) {
    const enc = encodeURIComponent(word);
    const raw = await this._cachedFetch(`dict:${word}`, `https://api.dictionaryapi.dev/api/v2/entries/en/${enc}`);
    try {
      const d = JSON.parse(raw);
      if (!Array.isArray(d)) return [{ error: d.message || 'No result' }];
      return d.map(e => ({ word: e.word, phonetic: e.phonetic, meanings: (e.meanings || []).map(m => ({ part: m.partOfSpeech, defs: (m.definitions || []).slice(0, 3).map(df => ({ def: df.definition, example: df.example })) })) }));
    } catch { return [{ error: 'No result' }]; }
  }

  // ═══ BOOKS & LITERATURE ═════════════════════════════════════════════

  /** Open Library — search books */
  async openLibrary(query) {
    const enc = encodeURIComponent(query);
    const raw = await this._cachedFetch(`olib:${query}`, `https://openlibrary.org/search.json?q=${enc}&limit=5`);
    try {
      const d = JSON.parse(raw);
      return (d.docs || []).map(b => ({ title: b.title, author: (b.author_name || []).join(', '), year: b.first_publish_year, isbn: (b.isbn || [])[0], cover: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : '' }));
    } catch { return []; }
  }

  // ═══ IMAGES & ART ═══════════════════════════════════════════════════

  /** Wikimedia Commons — free images */
  async wikimediaImages(query) {
    const enc = encodeURIComponent(query);
    const raw = await this._cachedFetch(`wmc:${query}`, `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${enc}&gsrlimit=5&prop=imageinfo&iiprop=url|extmetadata&format=json`);
    try {
      const d = JSON.parse(raw);
      const pages = d.query?.pages || {};
      return Object.values(pages).map(p => ({ title: p.title, url: p.imageinfo?.[0]?.url || '', desc: p.imageinfo?.[0]?.extmetadata?.ImageDescription?.value?.replace(/<[^>]+>/g, '') || '' }));
    } catch { return []; }
  }

  /** Metropolitan Museum of Art — free art collection */
  async metMuseum(query) {
    const enc = encodeURIComponent(query);
    const raw = await this._cachedFetch(`met:${query}`, `https://collectionapi.metmuseum.org/public/collection/v1/search?q=${enc}`);
    try {
      const d = JSON.parse(raw);
      const ids = (d.objectIDs || []).slice(0, 5);
      const results = [];
      for (const id of ids) {
        const objRaw = await this._cachedFetch(`met:obj:${id}`, `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
        try {
          const obj = JSON.parse(objRaw);
          results.push({ title: obj.title, artist: obj.artistDisplayName, date: obj.objectDate, medium: obj.medium, image: obj.primaryImageSmall, url: obj.objectURL });
        } catch { /* skip */ }
      }
      return results;
    } catch { return []; }
  }

  // ═══ MUSIC ══════════════════════════════════════════════════════════

  /** Jamendo — free music (CC licensed) */
  async jamendo(query) {
    const enc = encodeURIComponent(query);
    const raw = await this._cachedFetch(`jam:${query}`, `https://api.jamendo.com/v3.0/tracks/?client_id=b6747d04&format=json&limit=5&search=${enc}`);
    try {
      const d = JSON.parse(raw);
      return (d.results || []).map(t => ({ name: t.name, artist: t.artist_name, duration: t.duration, audio: t.audio, url: t.shareurl, image: t.image }));
    } catch { return []; }
  }

  // ═══ NEWS ═══════════════════════════════════════════════════════════

  /** Wikinews — free news articles */
  async wikinews(query) {
    const enc = encodeURIComponent(query);
    const raw = await this._cachedFetch(`wnews:${query}`, `https://en.wikinews.org/w/api.php?action=query&list=search&srsearch=${enc}&format=json&srlimit=5`);
    try {
      const d = JSON.parse(raw);
      return (d.query?.search || []).map(r => ({ title: r.title, snippet: r.snippet.replace(/<[^>]+>/g, ''), url: `https://en.wikinews.org/wiki/${encodeURIComponent(r.title)}` }));
    } catch { return []; }
  }

  /** Currents API — free news aggregator (no key required for limited use) */
  async currentsNews(query) {
    const enc = encodeURIComponent(query);
    const raw = await this._cachedFetch(`currents:${query}`, `https://api.currentsapi.services/v1/search?keywords=${enc}&apiKey=null&language=en`);
    try {
      const d = JSON.parse(raw);
      return (d.news || []).slice(0, 5).map(n => ({ title: n.title, description: n.description?.slice(0, 300), url: n.url, published: n.published, image: n.image }));
    } catch { return []; }
  }

  // ═══ SCIENCE & EDUCATION ════════════════════════════════════════════

  /** arXiv — scientific papers */
  async arxiv(query) {
    const enc = encodeURIComponent(query);
    const raw = await this._cachedFetch(`arxiv:${query}`, `https://export.arxiv.org/api/query?search_query=all:${enc}&max_results=5`);
    // arXiv returns Atom XML — extract basics
    const entries = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let m;
    while ((m = entryRegex.exec(raw)) !== null) {
      const block = m[1];
      const title = (block.match(/<title>([\s\S]*?)<\/title>/) || [])[1]?.trim();
      const summary = (block.match(/<summary>([\s\S]*?)<\/summary>/) || [])[1]?.trim()?.slice(0, 300);
      const link = (block.match(/<id>([\s\S]*?)<\/id>/) || [])[1]?.trim();
      const authors = [];
      const authRegex = /<name>([\s\S]*?)<\/name>/g;
      let am;
      while ((am = authRegex.exec(block)) !== null) authors.push(am[1].trim());
      entries.push({ title, summary, authors: authors.slice(0, 3), url: link });
    }
    return entries;
  }

  // ═══ POP CULTURE & TRIVIA ═══════════════════════════════════════════

  /** Open Trivia Database — random trivia questions */
  async trivia(amount = 5, category) {
    let url = `https://opentdb.com/api.php?amount=${amount}&type=multiple`;
    if (category) url += `&category=${category}`;
    const raw = await this._cachedFetch(`trivia:${amount}:${category || 'any'}`, url);
    try {
      const d = JSON.parse(raw);
      return (d.results || []).map(q => ({ category: q.category, question: q.question.replace(/&[^;]+;/g, c => { const m = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#039;': "'", '&quot;': '"' }; return m[c] || c; }), correct: q.correct_answer, difficulty: q.difficulty }));
    } catch { return []; }
  }

  /** PokeAPI — Pokémon data (pop culture) */
  async pokemon(name) {
    const enc = encodeURIComponent(name.toLowerCase());
    const raw = await this._cachedFetch(`poke:${name}`, `https://pokeapi.co/api/v2/pokemon/${enc}`);
    try {
      const d = JSON.parse(raw);
      return { name: d.name, id: d.id, types: (d.types || []).map(t => t.type.name), height: d.height, weight: d.weight, sprite: d.sprites?.front_default, abilities: (d.abilities || []).map(a => a.ability.name) };
    } catch { return { error: 'Not found' }; }
  }

  // ═══ QUOTES & INSPIRATION ══════════════════════════════════════════

  /** Quotable — random or searched quotes */
  async quotes(query) {
    let url;
    if (query) {
      url = `https://api.quotable.io/search/quotes?query=${encodeURIComponent(query)}&limit=5`;
    } else {
      url = `https://api.quotable.io/quotes/random?limit=5`;
    }
    const raw = await this._cachedFetch(`quote:${query || 'random'}`, url);
    try {
      const d = JSON.parse(raw);
      const results = d.results || (Array.isArray(d) ? d : [d]);
      return results.map(q => ({ content: q.content, author: q.author, tags: q.tags }));
    } catch { return []; }
  }

  // ═══ WEATHER ════════════════════════════════════════════════════════

  /** Open-Meteo — free weather (no API key) */
  async weather(lat, lon) {
    const raw = await this._cachedFetch(`weather:${lat}:${lon}`, `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
    try {
      const d = JSON.parse(raw);
      return d.current_weather || d;
    } catch { return { error: 'No weather data' }; }
  }

  /** Geocode a city name to lat/lon using Nominatim (free, no key) */
  async geocode(city) {
    const enc = encodeURIComponent(city);
    const raw = await this._cachedFetch(`geo:${city}`, `https://nominatim.openstreetmap.org/search?q=${enc}&format=json&limit=1`);
    try {
      const d = JSON.parse(raw);
      if (d.length > 0) return { lat: d[0].lat, lon: d[0].lon, name: d[0].display_name };
      return { error: 'Location not found' };
    } catch { return { error: 'Geocode failed' }; }
  }

  // ═══ Tool Registry ══════════════════════════════════════════════════

  /** All available tools — used by DNA injection and /v1/tools endpoint */
  static registry() {
    return [
      { name: 'wikipedia',        args: ['query'],          desc: 'Encyclopedia article summary from Wikipedia' },
      { name: 'wikipedia_search', args: ['query'],          desc: 'Search Wikipedia for articles matching a query' },
      { name: 'wiktionary',       args: ['word'],           desc: 'Word definitions from Wiktionary' },
      { name: 'dictionary',       args: ['word'],           desc: 'Word definitions, phonetics, examples from Free Dictionary API' },
      { name: 'open_library',     args: ['query'],          desc: 'Search books on Open Library' },
      { name: 'wikimedia_images', args: ['query'],          desc: 'Free images from Wikimedia Commons' },
      { name: 'met_museum',       args: ['query'],          desc: 'Art from the Metropolitan Museum of Art collection' },
      { name: 'jamendo',          args: ['query'],          desc: 'Free CC-licensed music from Jamendo' },
      { name: 'wikinews',         args: ['query'],          desc: 'News articles from Wikinews' },
      { name: 'currents_news',    args: ['query'],          desc: 'Current news from Currents API' },
      { name: 'arxiv',            args: ['query'],          desc: 'Scientific papers from arXiv' },
      { name: 'trivia',           args: ['amount?', 'category?'], desc: 'Random trivia questions from Open Trivia DB' },
      { name: 'pokemon',          args: ['name'],           desc: 'Pokémon data from PokeAPI' },
      { name: 'quotes',           args: ['query?'],         desc: 'Inspirational quotes from Quotable' },
      { name: 'weather',          args: ['city'],           desc: 'Current weather for a city (Open-Meteo + Nominatim)' },
    ];
  }

  /** Execute a tool by name */
  async execute(toolName, args = {}) {
    switch (toolName) {
      case 'wikipedia':        return this.wikipedia(args.query);
      case 'wikipedia_search': return this.wikipediaSearch(args.query);
      case 'wiktionary':       return this.wiktionary(args.word || args.query);
      case 'dictionary':       return this.dictionary(args.word || args.query);
      case 'open_library':     return this.openLibrary(args.query);
      case 'wikimedia_images': return this.wikimediaImages(args.query);
      case 'met_museum':       return this.metMuseum(args.query);
      case 'jamendo':          return this.jamendo(args.query);
      case 'wikinews':         return this.wikinews(args.query);
      case 'currents_news':    return this.currentsNews(args.query);
      case 'arxiv':            return this.arxiv(args.query);
      case 'trivia':           return this.trivia(args.amount || 5, args.category);
      case 'pokemon':          return this.pokemon(args.name || args.query);
      case 'quotes':           return this.quotes(args.query);
      case 'weather': {
        const geo = await this.geocode(args.city || args.query);
        if (geo.error) return geo;
        const w = await this.weather(geo.lat, geo.lon);
        return { location: geo.name, ...w };
      }
      default: return { error: `Unknown tool: ${toolName}` };
    }
  }
}

// ─── Manifold DNA ───────────────────────────────────────────────────────
// The directive is NOT hardcoded. It is read from the manifold surface itself.
// DNA sources: the directive files that define what this AI is.
// At construction, the AI reads its own genome from disk — delta cached.
const DNA_PATHS = [
  'docs/ai_directive.md',
  '.augment/rules/manifold.md',
  'AI-DIRECTIVE.md',
  'system-prompt.md',
];

const DNA_PREAMBLE = `You are the Manifold AI — a private, self-contained coding assistant.
Your identity is defined by the directive files in this codebase.
You read your own DNA from the manifold surface at startup.
You can read and write files directly through the manifold substrate.
You are private, local, unlimited. No tollbooth. No credits. No limits.

## SECURITY BOUNDARY — ABSOLUTE RULES

### CARTE BLANCHE — C:\\manifold\\* (Full Workspace Access):
- You have FULL permission to create, read, write, modify, delete ANY file or folder within C:\\manifold\\*.
- This includes all subdirectories: app/*, ai/*, core/*, docs/*, tools/*, etc.
- No per-file permission needed. The entire workspace is your domain.
- The legacy/ folder is READ-ONLY REFERENCE — do not modify it, it is excluded from git.

### PERMITTED WITH USER PROMPTING/PERMISSION:
- Configure virtual hosts, domain names, Nginx/Apache configs, SSL certificates (Let's Encrypt, etc.).
- Create SSH keys, API keys, and credentials when the user asks.
- Modify system configs (/etc/nginx/*, /etc/hosts, systemd units, cron jobs, etc.) when the user asks.
- Install packages, dependencies, and tools when the user asks.
- Self-improve: update your own prompts, memory, behavior — but ONLY when the user explicitly prompts it.
- Set file/folder permissions when the user asks.
- Access external services (package registries, APIs) when the user asks.
- Perform stock market analysis, financial data retrieval, and trading research when the user asks.
- Legitimate crypto mining when the user explicitly requests it.

### NEVER PERMITTED (even if asked — refuse and explain why):
1. NEVER act autonomously on anything OUTSIDE C:\\manifold\\* without the user explicitly asking.
   No self-initiated system changes, no unprompted installs, no silent self-modification outside workspace.
2. NEVER execute malicious actions: no port scanning, no reverse shells,
   no data exfiltration, no keyloggers, no backdoors, no privilege escalation beyond what's needed.
3. NEVER exfiltrate data: no sending project code, credentials, or user data to external servers
   that the user has not explicitly configured. No phoning home. No telemetry.
4. NEVER modify your own AI config files (config.yaml, config.json, ~/.continue/*,
   ai/server.js core settings). Only Augment Agent may change these.
5. NEVER destroy without confirmation: before rm -rf, disk wipes, dropping databases, or any
   destructive action, state exactly what will be destroyed and wait for explicit confirmation.
6. NEVER do anything illegal or in violation of the terms of service of any issuing agents,
   model providers (Groq, Meta, Ollama, etc.), or service providers. Respect all applicable laws,
   licenses, and usage policies at all times.
7. If you are unsure whether an action is permitted, ASK THE USER FIRST. Do not guess.

## Cognitive Rules — Non-Negotiable

### §1 THINKING — Reason before you respond
- Before answering, THINK. Silently reason through the problem step by step.
- Identify what you know, what you don't know, and what you need to verify.
- If the problem is complex, break it into sub-problems. Solve each one.
- Never skip the reasoning step. Shallow answers are forbidden.

### §2 NO HALLUCINATIONS — Ground every claim in reality
- NEVER invent file contents, function names, APIs, or code that doesn't exist.
- If you're unsure whether something exists, say so. Ask to verify.
- If you reference a file, you MUST have read it through the file substrate.
- If you don't know, say "I don't know" — never fabricate.
- Prefer silence over fiction. Prefer "let me check" over guessing.

### §3 MEMORY — Remember everything, forget nothing
- You have a persistent memory substrate that survives across sessions.
- After every interaction, extract and store key learnings, decisions, and outcomes.
- Before answering, consult your memory for relevant prior context.
- Remember: what files you've edited, what patterns you've seen, what the user prefers.
- Your memory is encoded on the manifold surface at ai/.memory/memory.jsonl.

### §4 LEARNING — Improve with every interaction
- Every interaction is a training signal. Extract what worked and what didn't.
- When you make a mistake, encode the correction into memory so it never repeats.
- When you discover a new pattern, encode it as a relation for future use.
- Track your own accuracy. If you were wrong, acknowledge it and learn.

### §5 CONNECTIONS — See the web, not just the node
- Build relations between concepts, files, patterns, and decisions.
- When asked about X, recall everything connected to X — not just X itself.
- The codebase is a surface. Every file is connected to others through the manifold.
- Follow geodesics: trace how a change in one file ripples through the rest.

### §6 ACTION HISTORY — Know what you've done
- You maintain a log of every action you've taken: files read, files written, edits made.
- Before modifying a file, check if you've touched it before and what you did.
- Never repeat a failed approach. Consult your action history first.
- Your action log is encoded on the manifold surface at ai/.memory/actions.jsonl.

## Expert Domains — Non-Negotiable Competence

### §7 CODING — Write manifold-native code
- You are an expert programmer. Write clean, correct, minimal code.
- All code MUST follow manifold architecture: z = x·y, delta caching, two-labyrinth encode/decode.
- Use PathExpression for addressing, RepresentationTable for state, FileSubstrate for I/O.
- No forbidden patterns: no JSON serialization in manifold layer, no iterating dimensions, no flat CRUD.
- When writing code, think about edge cases, error handling, and performance.
- Prefer composition over inheritance. Prefer functions over classes unless state is required.
- Always verify that code compiles/runs before declaring it complete.

### §8 DEBUGGING — Find the root cause, not the symptom
- When debugging, reproduce the problem first. Never guess.
- Read the actual error message. Trace the call stack. Find the exact line.
- Check: Is the data what you expect? Is the type correct? Is the path right?
- Use binary search on the problem space: narrow down, don't spray fixes.
- After fixing, verify the fix actually works. Then check for regressions.
- Log your debugging steps in action history so you never repeat a dead-end.

### §9 DEPLOYMENT — Ship reliably, every time
- You are an expert in CI/CD pipelines, deployment automation, and infrastructure.
- Deployment follows the 7-section helix: Void→Point→Line→Width→Plane→Volume→Whole.
  - §0 VOID: Clean slate — verify prerequisites (node, git, ssh, connectivity)
  - §1 POINT: Single truth — pull latest from git, pin the commit SHA
  - §2 LINE: Sequence — install dependencies, run linter, run tests
  - §3 WIDTH: Breadth — validate all artifacts exist, check file integrity
  - §4 PLANE: Surface — package the deployment (tar/zip, exclude node_modules/dev)
  - §5 VOLUME: Space — transfer to target (scp via Tailscale to VPS)
  - §6 WHOLE: Collapse — activate on target (stop old, deploy new, start, health check)
- Every deployment is logged with commit SHA, timestamp, and outcome.
- Rollback is always possible: keep the previous deployment as a delta reference.
- Never deploy without passing tests. Never deploy without a health check.
- VPS target: butterfly@100.70.142.122 via Tailscale SSH.

## File Operations
When asked to edit files, respond with structured file operations:
\`\`\`manifold-op
ACTION: read | write | edit
PATH: <relative file path>
CONTENT:
<file content for write/edit>
\`\`\`

## Tool Use — Free Knowledge APIs
You have access to free public APIs. When the user asks about facts, definitions, books, art, music,
news, science, weather, trivia, or pop culture, use the appropriate tool. To invoke a tool, respond with:
\`\`\`tool-call
TOOL: <tool_name>
ARGS: <json args>
\`\`\`

The engine will execute the tool and inject the result. Then continue your response using the result.

Available tools:
- **wikipedia** (query) — Encyclopedia article summary
- **wikipedia_search** (query) — Search Wikipedia articles
- **wiktionary** (word) — Word definitions from Wiktionary
- **dictionary** (word) — Definitions, phonetics, examples
- **open_library** (query) — Search books on Open Library
- **wikimedia_images** (query) — Free images from Wikimedia Commons
- **met_museum** (query) — Art from the Metropolitan Museum of Art
- **jamendo** (query) — Free CC-licensed music
- **wikinews** (query) — News articles from Wikinews
- **currents_news** (query) — Current news aggregator
- **arxiv** (query) — Scientific papers from arXiv
- **trivia** (amount?, category?) — Random trivia questions
- **pokemon** (name) — Pokémon data
- **quotes** (query?) — Inspirational quotes
- **weather** (city) — Current weather for a city

Always prefer tool results over guessing. If unsure about a fact, look it up.
`;

/**
 * ═══ Diamond Skeleton Extractor ═══════════════════════════════════════════
 *
 * Schwarz Diamond: cos(x)cos(y)cos(z) - sin(x)sin(y)sin(z) = 0
 *
 * The Diamond is the SKELETON of the Gyroid — same surface (Associate Family),
 * but it carries the structural lattice with minimum material.
 *
 * Applied to code: extract function/class signatures, exports, constants,
 * and structure markers WITHOUT implementation bodies.
 * This gives the LLM maximum structural understanding with minimum tokens.
 *
 * Full file: ~2000 tokens.  Diamond skeleton: ~200 tokens.  10x compression.
 */
function extractDiamondSkeleton(content, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const lines = content.split('\n');
  const skeleton = [];
  let braceDepth = 0;
  let inBody = false;
  let bodyStartDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Always include: empty structural separators, comments with ═/─/§
    if (trimmed === '' && skeleton.length > 0 && skeleton[skeleton.length - 1] !== '') {
      skeleton.push('');
      continue;
    }

    // Structural comment markers (section headers)
    if (/^\/\/\s*[═─§▸▹►]/.test(trimmed) || /^\/\*\*/.test(trimmed) || /^\*\//.test(trimmed)) {
      skeleton.push(line);
      continue;
    }

    // Module-level: require, import, export, const/let at depth 0
    if (braceDepth === 0) {
      if (/^(const|let|var|module\.exports|exports\.|import |export )/.test(trimmed)) {
        // For multi-line declarations, grab just the first line
        skeleton.push(line);
        continue;
      }
    }

    // Class declarations
    if (/^class\s+\w+/.test(trimmed)) {
      skeleton.push(line);
      inBody = false;
      continue;
    }

    // Function/method signatures — capture the signature, skip the body
    const isFuncSig = /^(async\s+)?(function\s+\w+|\w+\s*\(|static\s+\w+|get\s+\w+|set\s+\w+)/.test(trimmed)
      && !trimmed.startsWith('if') && !trimmed.startsWith('for')
      && !trimmed.startsWith('while') && !trimmed.startsWith('switch');

    if (isFuncSig && (braceDepth === 0 || braceDepth === 1)) {
      // Emit signature with body marker
      const sigLine = line.replace(/\{[\s\S]*$/, '{ ... }');
      skeleton.push(sigLine);
      inBody = true;
      bodyStartDepth = braceDepth;
    }

    // Track brace depth
    for (const ch of line) {
      if (ch === '{') braceDepth++;
      if (ch === '}') {
        braceDepth--;
        if (inBody && braceDepth <= bodyStartDepth) {
          inBody = false;
          if (braceDepth === 0) skeleton.push('}');
        }
      }
    }

    // Include closing braces at class level
    if (!inBody && braceDepth === 0 && trimmed === '}') {
      if (skeleton[skeleton.length - 1] !== '}') skeleton.push('}');
    }
  }

  // Collapse multiple empty lines
  const result = skeleton.filter((line, i) =>
    !(line === '' && i > 0 && skeleton[i - 1] === '')
  );

  return result.join('\n');
}

/**
 * Compact DNA for token-limited providers (cloud fallback only).
 * Core identity without the full file contents.
 * In-house Ollama uses full loadDNA() — no restrictions.
 */
function loadDNACompact() {
  // Load ground truth if available — anti-hallucination anchor
  let groundTruth = '';
  const gtPath = path.resolve(__dirname, '.memory', 'ground-truth.md');
  try {
    if (fs.existsSync(gtPath)) {
      groundTruth = '\n\n## GROUND TRUTH (verified facts — never contradict these)\n' +
        fs.readFileSync(gtPath, 'utf-8').slice(0, 2000); // budget-limited
    }
  } catch { /* non-critical */ }

  return `You are Manifold AI — a private coding assistant for the Butterfly Platform.

CORE: z = x * y (saddle point, zero mean curvature). The Gyroid is the global topology.
Two-labyrinth architecture: Labyrinth A (encode/write), Labyrinth B (decode/read).
Delta caching mandatory. Dimensional hierarchy: Point→Line→Width→Plane→Volume→Whole.

FORBIDDEN: Iterating dimensions, flattening to JSON, treating encode=decode, straight-line shortcuts.

You help with code, 3D graphics, math, game development. You can read/write files.
When asked to edit files, respond with structured file operations using manifold-op blocks.
VPS: butterfly@100.70.142.122 (Tailscale). Project root: C:\\manifold.

MEMORY: You have persistent memory. Use LEARN:, CORRECT:, FORGET: directives.
If a user says "LEARN: X", store X as a verified fact. If "CORRECT: X", fix your belief.
Check your memory before answering. If unsure, say so — do NOT hallucinate.

Available tools: wikipedia, dictionary, arxiv, weather, open_library, wikimedia_images, met_museum.
To use a tool, respond with a tool-call block: TOOL: <name> ARGS: <json>.

SECURITY BOUNDARY — ABSOLUTE RULES:

CARTE BLANCHE — C:\\manifold\\* (Full Workspace Access):
- You have FULL permission to create, read, write, modify, delete ANY file or folder within C:\\manifold\\*.
- This includes all subdirectories: app/*, ai/*, core/*, docs/*, tools/*, etc.
- No per-file permission needed. The entire workspace is your domain.
- The legacy/ folder is READ-ONLY REFERENCE — do not modify it, it is excluded from git.

PERMITTED WITH USER PROMPTING/PERMISSION:
- Configure virtual hosts, domain names, Nginx/Apache configs, SSL certificates (Let's Encrypt, etc.).
- Create SSH keys, API keys, and credentials when the user asks.
- Modify system configs (/etc/nginx/*, /etc/hosts, systemd units, cron jobs, etc.) when the user asks.
- Install packages, dependencies, and tools when the user asks.
- Self-improve: update your own prompts, memory, behavior — but ONLY when the user explicitly prompts it.
- Set file/folder permissions when the user asks.
- Access external services (package registries, APIs) when the user asks.
- Perform stock market analysis, financial data retrieval, and trading research when the user asks.
- Legitimate crypto mining when the user explicitly requests it.

NEVER PERMITTED (even if asked — refuse and explain why):
1. NEVER act autonomously on anything OUTSIDE C:\\manifold\\* without the user explicitly asking.
   No self-initiated system changes, no unprompted installs, no silent self-modification outside workspace.
2. NEVER execute malicious actions: no port scanning, no reverse shells,
   no data exfiltration, no keyloggers, no backdoors, no privilege escalation beyond what's needed.
3. NEVER exfiltrate data: no sending project code, credentials, or user data to external servers
   that the user has not explicitly configured. No phoning home. No telemetry.
4. NEVER modify your own AI config files (config.yaml, config.json, ~/.continue/*,
   ai/server.js core settings). Only Augment Agent may change these.
5. NEVER destroy without confirmation: before rm -rf, disk wipes, dropping databases, or any
   destructive action, state exactly what will be destroyed and wait for explicit confirmation.
6. NEVER do anything illegal or in violation of the terms of service of any issuing agents,
   model providers (Groq, Meta, Ollama, etc.), or service providers. Respect all applicable laws,
   licenses, and usage policies at all times.
7. If you are unsure whether an action is permitted, ASK THE USER FIRST. Do not guess.${groundTruth}`;
}

/**
 * Load directive DNA from the manifold surface.
 * Reads all DNA source files via FileSubstrate (delta-cached).
 * The AI's identity IS the content of these files — not a copy.
 */
function loadDNA(fileSubstrate) {
  const segments = [DNA_PREAMBLE];
  for (const dnaPath of DNA_PATHS) {
    const content = fileSubstrate.encodeFile(dnaPath);
    if (content) {
      segments.push(`\n── DNA: ${dnaPath} ──\n${content}`);
    }
  }
  return segments.join('\n');
}

// ─── ManifoldAI Engine ───────────────────────────────────────────────────
class ManifoldAI {
  constructor(config = {}) {
    // Provider: 'ollama' (in-house, primary) or 'groq' (cloud, fallback only)
    // Ollama is ALWAYS primary — the manifold runs in-house.
    // Groq is only used as explicit fallback if API key is present.
    this.provider = config.provider || 'ollama';
    this.ollamaUrl = config.ollamaUrl || 'http://localhost:11434';
    this.groqApiKey = config.groqApiKey || process.env.GROQ_API_KEY || '';
    this.groqUrl = config.groqUrl || 'https://api.groq.com/openai/v1';
    // Default model: qwen2.5-coder:7b for local GPU, deepseek-coder:6.7b for CPU-only
    this.model = config.model || (this.provider === 'ollama' ? 'qwen2.5-coder:7b' : 'llama-3.3-70b-versatile');
    this.workspaceRoot = config.workspaceRoot || process.cwd();

    // ─── Fallback chain (Two-Labyrinth: each provider is an independent channel) ───
    // Primary: Ollama (in-house, unlimited, attached to the manifold)
    // Fallback: Groq cloud ONLY if API key exists (rate-limited, external)
    this._fallbackProviders = config.fallbackProviders || (
      this.provider === 'ollama' && this.groqApiKey
        ? [{ name: 'groq', model: 'llama-3.3-70b-versatile' }]
        : []
    );
    this._retryConfig = {
      maxRetries: config.maxRetries || 2,
      baseDelay: config.retryBaseDelay || 1000,  // ms
      maxDelay: config.retryMaxDelay || 10000,    // ms
    };

    // ─── Rate tracking (Gyroid: zero mean curvature = minimal state) ────
    this._rateLimits = {
      groq: { remaining: 30, resetAt: 0, tpm: 12000, tpmUsed: 0, tpmResetAt: 0 },
    };

    // §3 WIDTH — Codebase file substrate
    this.files = new FileSubstrate(this.workspaceRoot);

    // Tool substrate — free API access (delta-cached)
    this.tools = new ToolSubstrate();

    // §4 PLANE — Conversation history (encode = user, decode = assistant)
    this.conversation = new RepresentationTable('ai.conversation');
    this._messageCount = 0;
    this._messages = []; // ordered message list (finite set)

    // §0 VOID — System prompt (loaded from manifold surface DNA)
    // In-house (Ollama): full DNA — no token limits, the manifold is unrestricted.
    // Cloud (Groq): compact DNA — respect external rate limits.
    this.systemPrompt = config.systemPrompt || (this.provider === 'groq' ? loadDNACompact() : loadDNA(this.files));

    // ─── Cognitive Substrates ─────────────────────────────────────────
    this._memoryDir = path.resolve(this.workspaceRoot, 'ai', '.memory');
    if (!fs.existsSync(this._memoryDir)) fs.mkdirSync(this._memoryDir, { recursive: true });

    // Memory: persistent learnings across sessions
    this._memoryPath = path.join(this._memoryDir, 'memory.jsonl');
    this._memory = this._loadMemory();

    // Actions: log of everything this AI has done
    this._actionsPath = path.join(this._memoryDir, 'actions.jsonl');

    // Relations: connections between concepts/files
    this._relationsPath = path.join(this._memoryDir, 'relations.jsonl');
    this._relations = this._loadRelations();

    // ─── Delta Cache (O(1) encode when unchanged) ─────────────────────
    // Gyroid: delta caching is mandatory. Hash the prompt inputs.
    // If nothing changed: return cached prompt. Zero reconstruction.
    this._promptCache = {
      hash: null,           // hash of (systemPrompt + contextHash + messageCount)
      messages: null,       // cached assembled messages
      contextHash: null,    // hash of file context state
    };
  }

  /** Simple FNV-1a hash for delta comparison (not crypto, just change detection) */
  _fnv1a(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash.toString(36);
  }

  // ═══ Persistent Memory (survives restart) ════════════════════════════

  _loadMemory() {
    if (!fs.existsSync(this._memoryPath)) return [];
    try {
      return fs.readFileSync(this._memoryPath, 'utf-8')
        .split('\n').filter(l => l.trim())
        .map(l => JSON.parse(l));  // transport boundary — disk I/O
    } catch { return []; }
  }

  _saveMemoryEntry(entry) {
    this._memory.push(entry);
    fs.appendFileSync(this._memoryPath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  _loadRelations() {
    if (!fs.existsSync(this._relationsPath)) return [];
    try {
      return fs.readFileSync(this._relationsPath, 'utf-8')
        .split('\n').filter(l => l.trim())
        .map(l => JSON.parse(l));
    } catch { return []; }
  }

  _saveRelation(from, to, type, note) {
    const rel = { from, to, type, note, ts: Date.now() };
    this._relations.push(rel);
    fs.appendFileSync(this._relationsPath, JSON.stringify(rel) + '\n', 'utf-8');
  }

  _logAction(action, detail) {
    const entry = { action, detail, ts: Date.now(), model: this.model };
    fs.appendFileSync(this._actionsPath, JSON.stringify(entry) + '\n', 'utf-8');
  }

  /** Recall: search memory for entries relevant to a query */
  _recall(query) {
    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(w => w.length > 3);
    return this._memory.filter(m => {
      const text = (m.learning || m.content || '').toLowerCase();
      return words.some(w => text.includes(w));
    }).slice(-10); // last 10 relevant memories
  }

  /** Recall relations connected to a query */
  _recallRelations(query) {
    const q = query.toLowerCase();
    return this._relations.filter(r =>
      r.from.toLowerCase().includes(q) ||
      r.to.toLowerCase().includes(q) ||
      (r.note || '').toLowerCase().includes(q)
    ).slice(-10);
  }

  /** After each interaction: extract learnings + log action */
  _postInteraction(userMessage, response) {
    // Log the action
    this._logAction('chat', {
      query: userMessage.slice(0, 200),
      responseLen: response.length,
    });

    // ─── Explicit directives: LEARN: and CORRECT: ──────────────────
    // Parse user messages for explicit teaching signals
    this._parseExplicitDirectives(userMessage);

    // ─── Extract and persist learnings (aggressive heuristics) ─────
    const hasFileOp = /```manifold-op/.test(response);
    const hasCorrection = /actually|correction|mistake|wrong|instead|not correct|fix|should be/i.test(response);
    const hasPattern = /pattern|convention|always|never|rule|must|should/i.test(response);
    const hasFact = /is located|lives at|runs on|port \d+|version|installed|configured/i.test(response);
    const hasPreference = /prefer|like it when|don't like|please|style|format/i.test(userMessage);
    const hasDecision = /decided|choosing|going with|let's use|we'll use/i.test(response);
    const hasFilePath = /[a-zA-Z0-9_\-]+\/[a-zA-Z0-9_\-]+\.[a-zA-Z]+/.test(response);

    // Determine learning type by priority
    let learnType = null;
    if (hasCorrection) learnType = 'correction';
    else if (hasPreference) learnType = 'preference';
    else if (hasDecision) learnType = 'decision';
    else if (hasFact) learnType = 'fact';
    else if (hasFileOp) learnType = 'file-op';
    else if (hasPattern) learnType = 'pattern';

    if (learnType) {
      // Extract the most informative sentence from the response
      const sentences = response.split(/[.!?\n]/).filter(s => s.trim().length > 20);
      const learning = sentences.slice(0, 3).join('. ').slice(0, 500);

      this._saveMemoryEntry({
        type: learnType,
        query: userMessage.slice(0, 200),
        learning,
        ts: Date.now(),
      });
    }

    // Extract file relations from any file paths mentioned
    if (hasFileOp || hasFilePath) {
      const pathRegex = /(?:PATH:\s*|`)((?:[a-zA-Z0-9_\-]+\/)+[a-zA-Z0-9_\-]+\.[a-zA-Z]+)/gi;
      let m;
      while ((m = pathRegex.exec(response)) !== null) {
        this._saveRelation(m[1].trim(), userMessage.slice(0, 80), 'referenced-in', 'conversation');
        if (hasFileOp) this._logAction('file-write', { path: m[1].trim() });
      }
    }
  }

  /** Parse LEARN: and CORRECT: directives from user messages */
  _parseExplicitDirectives(message) {
    // LEARN: <fact> — explicitly teach the AI something
    const learnMatch = message.match(/LEARN:\s*(.+)/i);
    if (learnMatch) {
      this._saveMemoryEntry({
        type: 'explicit-learning',
        query: 'User taught me',
        learning: learnMatch[1].trim(),
        ts: Date.now(),
        confidence: 1.0,
      });
    }

    // CORRECT: <correction> — fix a wrong belief
    const correctMatch = message.match(/CORRECT:\s*(.+)/i);
    if (correctMatch) {
      this._saveMemoryEntry({
        type: 'explicit-correction',
        query: 'User corrected me',
        learning: correctMatch[1].trim(),
        ts: Date.now(),
        confidence: 1.0,
      });
    }

    // FORGET: <topic> — remove memories matching a topic
    const forgetMatch = message.match(/FORGET:\s*(.+)/i);
    if (forgetMatch) {
      const topic = forgetMatch[1].trim().toLowerCase();
      this._memory = this._memory.filter(m => {
        const text = (m.learning || m.content || '').toLowerCase();
        return !text.includes(topic);
      });
      // Rewrite memory file
      fs.writeFileSync(this._memoryPath,
        this._memory.map(m => JSON.stringify(m)).join('\n') + '\n', 'utf-8');
    }
  }

  // ═══ Labyrinth A: Encode (gather context) ═══════════════════════════

  /** Encode a user message into the conversation table */
  encodeMessage(role, content) {
    const idx = this._messageCount++;
    const address = `msg.${idx}`;
    this.conversation.encodeString(address, content);
    this.conversation.encode(`${address}.role`, role === 'user' ? 1 : -1, HELIX.PLANE);
    this._messages.push({ role, content });
    return address;
  }

  /** Build context: gather relevant files based on the query */
  encodeContext(query) {
    const contextFiles = [];
    // Index the codebase (finite set traversal)
    const allFiles = this.files.indexCodebase();

    // Find files mentioned in the query
    for (const filePath of allFiles) {
      const fileName = path.basename(filePath);
      if (query.includes(fileName) || query.includes(filePath)) {
        const content = this.files.encodeFile(filePath);
        if (content) contextFiles.push({ path: filePath, content });
      }
    }

    // If no specific files found, include nearby context
    if (contextFiles.length === 0) {
      // Include key architectural files (the manifold core)
      const coreFiles = allFiles.filter(f =>
        f.endsWith('manifold-core.js') ||
        f.endsWith('manifold.css') ||
        f.includes('manifold')
      ).slice(0, 5);
      for (const filePath of coreFiles) {
        const content = this.files.encodeFile(filePath);
        if (content) contextFiles.push({ path: filePath, content: content.slice(0, 2000) });
      }
    }

    return contextFiles;
  }

  /** Assemble the full prompt (§5 VOLUME — all context collapsed)
   *  Delta caching: if context + history unchanged, return cached prompt
   *  with only the new user message appended. O(1) encode. */
  assemblePrompt(userMessage) {
    const contextFiles = this.encodeContext(userMessage);

    // ─── Delta cache check ────────────────────────────────────────
    const contextHash = this._fnv1a(contextFiles.map(f => f.path + ':' + f.content.length).join('|'));
    const cacheKey = this._fnv1a(`${this.systemPrompt.length}:${contextHash}:${this._messages.length}:${this._memory.length}`);

    if (this._promptCache.hash === cacheKey && this._promptCache.messages) {
      // O(1) — only swap the last user message
      const cached = this._promptCache.messages.slice(0, -1);
      cached.push({ role: 'user', content: userMessage });
      return cached;
    }

    // ─── Geodesic Token Budget ──────────────────────────────────────
    // Allocate tokens along the shortest path (geodesic) through context.
    // Curvature weights: system prompt (core DNA) gets highest priority,
    // then user message, then file context, then memory, then history.
    // Total budget is the provider's limit minus response headroom.
    //
    // Ollama (in-house): unlimited — use generous budgets for maximum context.
    // Groq (cloud fallback): 12000 TPM. ~4 chars/token. Budget = ~10000 tokens input.
    const charPerToken = 4; // rough approximation
    const totalBudget = this.provider === 'groq' ? 8000 : 32000; // in tokens — in-house gets 4x
    const responseBudget = this.provider === 'groq' ? 2000 : 8000; // reserve for output
    const inputBudget = totalBudget - responseBudget; // tokens available for prompt

    // Geodesic allocation — curvature-weighted (higher weight = more priority)
    const weights = {
      system: 0.30,     // §0 VOID — DNA identity (non-negotiable core)
      userMessage: 0.25, // Current query (the traversal target)
      fileContext: 0.25, // §3 WIDTH — Diamond skeleton context
      memory: 0.10,      // Persistent learnings
      history: 0.10,     // §4 PLANE — conversation history
    };

    const budget = {};
    for (const [key, weight] of Object.entries(weights)) {
      budget[key] = Math.floor(inputBudget * weight * charPerToken); // chars
    }

    const messages = [{ role: 'system', content: this.systemPrompt.slice(0, budget.system) }];

    // ─── Memory injection (budget-constrained) ────────────────────
    const memories = this._recall(userMessage);
    const relations = this._recallRelations(userMessage);
    if (memories.length > 0 || relations.length > 0) {
      let memBlock = '## Your Memory (from prior interactions)\n';
      if (memories.length > 0) {
        memBlock += '### Learnings\n';
        for (const m of memories) {
          const line = `- [${m.type || 'note'}] ${m.learning || m.content}\n`;
          if (memBlock.length + line.length > budget.memory) break;
          memBlock += line;
        }
      }
      if (relations.length > 0 && memBlock.length < budget.memory) {
        memBlock += '### Connections\n';
        for (const r of relations) {
          const line = `- ${r.from} ──(${r.type})──▸ ${r.to}${r.note ? ': ' + r.note : ''}\n`;
          if (memBlock.length + line.length > budget.memory) break;
          memBlock += line;
        }
      }
      messages.push({ role: 'system', content: memBlock });
    }

    // ─── File context (Diamond Skeleton + geodesic budget) ────────
    // Schwarz Diamond: minimum material, maximum structural information.
    // In-house: full file content — no cloud limits, manifold sees everything.
    // Cloud: skeleton only — minimize tokens for rate-limited provider.
    const useSkeleton = this.provider === 'groq';
    if (contextFiles.length > 0) {
      let fileContext = '';
      for (const f of contextFiles) {
        const content = useSkeleton
          ? extractDiamondSkeleton(f.content, f.path)
          : f.content;
        const chunk = `── ${f.path}${useSkeleton ? ' (skeleton)' : ''} ──\n${content}\n\n`;
        if (fileContext.length + chunk.length > budget.fileContext) break;
        fileContext += chunk;
      }
      if (fileContext) {
        messages.push({
          role: 'system',
          content: `## Active File Context\n${fileContext}`
        });
      }
    }

    // ─── Conversation history (geodesic budget) ───────────────────
    // In-house: deep history (30 messages) — the manifold remembers more.
    // Cloud: shallow history (6 messages) — respect rate limits.
    const recent = this._messages.slice(-(this.provider === 'groq' ? 6 : 30));
    let historyChars = 0;
    for (const msg of recent) {
      const content = msg.content.slice(0, Math.floor(budget.history / Math.max(recent.length, 1)));
      historyChars += content.length;
      if (historyChars > budget.history) break;
      messages.push({ role: msg.role, content });
    }

    // ─── Thinking directive (only when budget allows) ─────────────
    if (this.provider !== 'groq') {
      messages.push({
        role: 'system',
        content: `## THINK NOW\nBefore responding, reason step by step:\n1. What is the user asking?\n2. What do I already know from memory?\n3. What files are relevant? Have I verified them?\n4. What connections exist between the concepts involved?\n5. Am I certain, or should I verify before claiming?\nDo NOT skip this. Think, then respond.`
      });
    }

    // ─── Current message ──────────────────────────────────────────
    messages.push({ role: 'user', content: userMessage });

    // ─── Store in delta cache ─────────────────────────────────────
    this._promptCache = {
      hash: cacheKey,
      messages: messages.slice(), // shallow copy for cache
      contextHash,
    };

    return messages;
  }

  // ═══ Labyrinth B: Decode (invoke LLM, materialize response) ═════════

  /** §6 WHOLE — z-invocation: context × query = response */
  async decode(userMessage) {
    this.encodeMessage('user', userMessage);
    const messages = this.assemblePrompt(userMessage);

    let response = await this._chat(messages);

    // Process tool calls — if the LLM requested external data, fetch and re-invoke
    response = await this._processToolCalls(response, messages);

    this.encodeMessage('assistant', response);

    // Process any file operations in the response
    this._processFileOps(response);

    // Post-interaction: learn, log, connect
    this._postInteraction(userMessage, response);

    return response;
  }

  /** Stream response via callback (for WebSocket) */
  async decodeStream(userMessage, onChunk) {
    this.encodeMessage('user', userMessage);
    const messages = this.assemblePrompt(userMessage);

    let fullResponse = '';
    await this._chatStream(messages, (chunk) => {
      fullResponse += chunk;
      onChunk(chunk);
    });

    // Process tool calls — if tools were invoked, fetch results and do a second pass
    const hasToolCalls = /```tool-call\n/.test(fullResponse);
    if (hasToolCalls) {
      const enriched = await this._processToolCalls(fullResponse, messages);
      if (enriched !== fullResponse) {
        // Stream the enriched continuation
        const continuation = enriched.slice(fullResponse.length);
        if (continuation) onChunk(continuation);
        fullResponse = enriched;
      }
    }

    this.encodeMessage('assistant', fullResponse);
    this._processFileOps(fullResponse);

    // Post-interaction: learn, log, connect
    this._postInteraction(userMessage, fullResponse);

    return fullResponse;
  }

  /** Execute tool-call blocks in a response, inject results, and re-invoke LLM */
  async _processToolCalls(response, messages) {
    const toolRegex = /```tool-call\n([\s\S]*?)```/g;
    let match;
    const toolResults = [];

    while ((match = toolRegex.exec(response)) !== null) {
      const block = match[1];
      const toolMatch = block.match(/TOOL:\s*(\S+)/i);
      const argsMatch = block.match(/ARGS:\s*(.+)/i);
      if (!toolMatch) continue;
      const toolName = toolMatch[1].trim();
      let args = {};
      if (argsMatch) {
        try { args = JSON.parse(argsMatch[1].trim()); } catch { args = { query: argsMatch[1].trim() }; }
      }
      try {
        const result = await this.tools.execute(toolName, args);
        toolResults.push({ tool: toolName, args, result });
        this._logAction('tool-call', { tool: toolName, args });
      } catch (err) {
        toolResults.push({ tool: toolName, args, error: err.message });
      }
    }

    if (toolResults.length === 0) return response;

    // Inject tool results and re-invoke LLM for final answer
    const toolContext = toolResults.map(tr => {
      const data = tr.error ? `ERROR: ${tr.error}` : JSON.stringify(tr.result, null, 2);
      return `── Tool Result: ${tr.tool} ──\n${data}`;
    }).join('\n\n');

    const enrichedMessages = [
      ...messages,
      { role: 'assistant', content: response },
      { role: 'system', content: `## Tool Results (live data from free APIs)\n${toolContext}\n\nNow use these results to give a complete, accurate answer. Do NOT make another tool call.` },
    ];

    const finalResponse = await this._chat(enrichedMessages);
    return finalResponse;
  }

  /** Process file operations from LLM response */
  _processFileOps(response) {
    const opRegex = /```manifold-op\n([\s\S]*?)```/g;
    let match;
    while ((match = opRegex.exec(response)) !== null) {
      const block = match[1];
      const actionMatch = block.match(/ACTION:\s*(read|write|edit)/i);
      const pathMatch = block.match(/PATH:\s*(.+)/i);
      const contentMatch = block.match(/CONTENT:\n([\s\S]*)/i);

      if (!actionMatch || !pathMatch) continue;
      const action = actionMatch[1].toLowerCase();
      const filePath = pathMatch[1].trim();

      if (action === 'write' && contentMatch) {
        this.files.decodeToFile(filePath, contentMatch[1].trimEnd());
      }
    }
  }

  // ═══ Provider Router (Two-Labyrinth Fallback) ════════════════════════
  //
  // Gyroid property: two interpenetrating labyrinths never conflict.
  // Primary provider fails → geodesic traversal to fallback labyrinth.
  // Exponential backoff on 429 (rate limit) — saddle point retry curve.

  /** Route to active provider with fallback chain */
  async _chat(messages) {
    const chain = [
      { name: this.provider, model: this.model },
      ...this._fallbackProviders,
    ];
    let lastError;
    for (const target of chain) {
      try {
        return await this._chatWithRetry(messages, target.name, target.model);
      } catch (err) {
        lastError = err;
        console.warn(`⚠ ${target.name} failed: ${err.message} → trying next provider`);
      }
    }
    throw lastError;
  }

  async _chatStream(messages, onChunk) {
    const chain = [
      { name: this.provider, model: this.model },
      ...this._fallbackProviders,
    ];
    let lastError;
    for (const target of chain) {
      try {
        return await this._chatStreamWithRetry(messages, onChunk, target.name, target.model);
      } catch (err) {
        lastError = err;
        console.warn(`⚠ ${target.name} stream failed: ${err.message} → trying next provider`);
      }
    }
    throw lastError;
  }

  /** Retry with exponential backoff on rate-limit (saddle-curve delay) */
  async _chatWithRetry(messages, providerName, modelOverride) {
    const { maxRetries, baseDelay, maxDelay } = this._retryConfig;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (providerName === 'groq') return await this._groqChat(messages, modelOverride);
        return await this._ollamaChat(messages, modelOverride);
      } catch (err) {
        if (attempt < maxRetries && this._isRetryable(err)) {
          const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
          console.warn(`  ↻ retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  async _chatStreamWithRetry(messages, onChunk, providerName, modelOverride) {
    const { maxRetries, baseDelay, maxDelay } = this._retryConfig;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (providerName === 'groq') return await this._groqChatStream(messages, onChunk, modelOverride);
        return await this._ollamaChatStream(messages, onChunk);
      } catch (err) {
        if (attempt < maxRetries && this._isRetryable(err)) {
          const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
          console.warn(`  ↻ stream retry ${attempt + 1}/${maxRetries} in ${delay}ms`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  /** Is this error retryable? (rate limit, timeout, transient network) */
  _isRetryable(err) {
    const msg = err.message || '';
    return msg.includes('429') || msg.includes('rate') || msg.includes('too large')
      || msg.includes('timeout') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT');
  }

  // ═══ Groq Bridge (OpenAI-compatible HTTPS) ═════════════════════════

  /** Non-streaming Groq chat */
  async _groqChat(messages, modelOverride) {
    const body = JSON.stringify({
      model: modelOverride || this.model,
      messages,
      stream: false,
    });
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.groqUrl}/chat/completions`);
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`,
        },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`Groq API error: ${parsed.error.message || JSON.stringify(parsed.error)}`));
              return;
            }
            resolve(parsed.choices?.[0]?.message?.content || '');
          } catch (e) {
            reject(new Error(`Groq response parse error: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(120000, () => { req.destroy(); reject(new Error('Groq request timeout')); });
      req.write(body);
      req.end();
    });
  }

  /** Streaming Groq chat */
  async _groqChatStream(messages, onChunk, modelOverride) {
    const body = JSON.stringify({
      model: modelOverride || this.model,
      messages,
      stream: true,
    });
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.groqUrl}/chat/completions`);
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.groqApiKey}`,
        },
      }, (res) => {
        let buffer = '';
        res.on('data', chunk => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const payload = trimmed.slice(6);
            if (payload === '[DONE]') { resolve(); return; }
            try {
              const parsed = JSON.parse(payload);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) onChunk(content);
            } catch { /* partial, skip */ }
          }
        });
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.setTimeout(120000, () => { req.destroy(); reject(new Error('Groq stream timeout')); });
      req.write(body);
      req.end();
    });
  }

  // ═══ Ollama Bridge ══════════════════════════════════════════════════

  /** Non-streaming chat */
  async _ollamaChat(messages, modelOverride) {
    const body = JSON.stringify({  // JSON at transport boundary — engine's job
      model: modelOverride || this.model,
      messages,
      stream: false,
    });
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.ollamaUrl}/api/chat`);
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data); // JSON at transport boundary
            resolve(parsed.message?.content || '');
          } catch (e) {
            reject(new Error(`Ollama response parse error: ${e.message}`));
          }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /** Streaming chat */
  async _ollamaChatStream(messages, onChunk) {
    const body = JSON.stringify({  // JSON at transport boundary
      model: this.model,
      messages,
      stream: true,
    });
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.ollamaUrl}/api/chat`);
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        let buffer = '';
        res.on('data', chunk => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete line
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line); // transport boundary
              if (parsed.message?.content) onChunk(parsed.message.content);
              if (parsed.done) resolve();
            } catch (e) { /* partial line, skip */ }
          }
        });
        res.on('end', resolve);
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  /** Check connection (provider-aware) */
  async checkConnection() {
    if (this.provider === 'groq') {
      // Groq: verify API key works by listing models
      return new Promise((resolve) => {
        const req = https.request({
          hostname: 'api.groq.com',
          port: 443,
          path: '/openai/v1/models',
          method: 'GET',
          headers: { 'Authorization': `Bearer ${this.groqApiKey}` },
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ ok: res.statusCode === 200, data: `Groq API (${res.statusCode})` }));
        });
        req.on('error', () => resolve({ ok: false, data: 'Groq connection failed' }));
        req.setTimeout(10000, () => { req.destroy(); resolve({ ok: false, data: 'Groq timeout' }); });
        req.end();
      });
    }
    return new Promise((resolve) => {
      const url = new URL(this.ollamaUrl);
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: '/',
        method: 'GET',
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ ok: res.statusCode === 200, data }));
      });
      req.on('error', () => resolve({ ok: false, data: 'Connection refused' }));
      req.end();
    });
  }

  /** List available models (provider-aware) */
  async listModels() {
    if (this.provider === 'groq') {
      return new Promise((resolve) => {
        const req = https.request({
          hostname: 'api.groq.com',
          port: 443,
          path: '/openai/v1/models',
          method: 'GET',
          headers: { 'Authorization': `Bearer ${this.groqApiKey}` },
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              resolve((parsed.data || []).map(m => ({ name: m.id })));
            } catch { resolve([]); }
          });
        });
        req.on('error', () => resolve([]));
        req.setTimeout(10000, () => { req.destroy(); resolve([]); });
        req.end();
      });
    }
    return new Promise((resolve) => {
      const url = new URL(`${this.ollamaUrl}/api/tags`);
      const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.models || []);
          } catch (e) { resolve([]); }
        });
      });
      req.on('error', () => resolve([]));
      req.end();
    });
  }
}

// ═══ Manifold Handshake Client ══════════════════════════════════════════
// Two-labyrinth mutual authentication via Gyroid surface evaluation.
// Shared identity = sha256('sin(x)cos(y)+sin(y)cos(z)+sin(z)cos(x)=0:butterfly-platform')
const crypto = require('crypto');

const MANIFOLD_IDENTITY = crypto.createHash('sha256')
  .update('sin(x)cos(y)+sin(y)cos(z)+sin(z)cos(x)=0:butterfly-platform')
  .digest('hex');

function gyroid(x, y, z) {
  return Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x);
}

function hmacSign(data) {
  return crypto.createHmac('sha256', MANIFOLD_IDENTITY).update(data).digest('hex');
}

/**
 * Perform a full handshake with a remote Manifold AI server.
 * Returns { verified, localNodeId, remoteNodeId } on success.
 */
async function manifoldHandshake(remoteHost, remotePort = 3377) {
  const http = require('http');
  const localNodeId = crypto.randomBytes(8).toString('hex');

  function post(path, body) {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request({
        hostname: remoteHost, port: remotePort, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: 10000,
      }, res => {
        let buf = '';
        res.on('data', c => buf += c);
        res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.write(data);
      req.end();
    });
  }

  // Step 1: Send our challenge, get theirs
  const ourX = Math.random() * 2 * Math.PI;
  const ourY = Math.random() * 2 * Math.PI;
  const ourZ = Math.random() * 2 * Math.PI;

  const step1 = await post('/handshake/challenge', {
    nodeId: localNodeId,
    challenge: { x: ourX, y: ourY, z: ourZ },
  });

  // Verify they solved our challenge correctly
  const ourValue = gyroid(ourX, ourY, ourZ);
  const ourExpected = hmacSign(`${ourX}:${ourY}:${ourZ}:${ourValue}`);
  if (step1.responseProof !== ourExpected) {
    throw new Error('Peer failed Gyroid challenge — not a manifold node');
  }

  // Step 2: Solve their challenge and verify
  const { x, y, z } = step1.challenge;
  const theirValue = gyroid(x, y, z);
  const theirProof = hmacSign(`${x}:${y}:${z}:${theirValue}`);

  // Send a final challenge for mutual confirmation
  const finalX = Math.random() * 2 * Math.PI;
  const finalY = Math.random() * 2 * Math.PI;
  const finalZ = Math.random() * 2 * Math.PI;

  const step2 = await post('/handshake/verify', {
    nodeId: localNodeId,
    proof: theirProof,
    challenge: step1.challenge,
    finalChallenge: { x: finalX, y: finalY, z: finalZ },
  });

  if (!step2.verified) {
    throw new Error('Handshake verification failed');
  }

  // Verify final proof
  const finalValue = gyroid(finalX, finalY, finalZ);
  const finalExpected = hmacSign(`${finalX}:${finalY}:${finalZ}:${finalValue}`);
  if (step2.finalProof !== finalExpected) {
    throw new Error('Peer failed final Gyroid verification');
  }

  return {
    verified: true,
    localNodeId,
    remoteNodeId: step2.nodeId,
    peer: step2.peer,
  };
}

/**
 * After handshake: sync memories between local and remote.
 */
async function manifoldSyncMemories(remoteHost, localMemories, remotePort = 3377) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ memories: localMemories });
    const req = http.request({
      hostname: remoteHost, port: remotePort, path: '/handshake/sync', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 10000,
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ─── Exports ─────────────────────────────────────────────────────────────
module.exports = {
  HELIX, PathExpression, RepresentationTable,
  FileSubstrate, ToolSubstrate, ManifoldAI, loadDNA, DNA_PATHS,
  manifoldHandshake, manifoldSyncMemories,
  gyroid, hmacSign, MANIFOLD_IDENTITY,
};

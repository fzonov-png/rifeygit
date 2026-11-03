/* RifeyGit — минимальная работа с GitHub API (без зависимостей).
 *
 * Токен (fine-grained, Contents: Read and write на этот репозиторий)
 * хранится в localStorage браузера под ключом rifeygit_token.
 *
 * Запись выполняется «одним коммитом» через Git Data API:
 * blobs -> tree -> commit -> обновление ветки main. Так все файлы
 * одной операции попадают в репозиторий атомарно.
 */
'use strict';

/* Куда пишем: <владелец>/<репозиторий>. Меняется одной строкой. */
const GH_REPO = 'fzonov-png/rifeygit';
const GH_BRANCH = 'main';

const GH = {
  token() { return localStorage.getItem('rifeygit_token') || ''; },
  setToken(t) { localStorage.setItem('rifeygit_token', t.trim()); },
  hasToken() { return !!this.token(); },

  api(method, path, body) {
    return fetch('https://api.github.com' + path, {
      method,
      cache: 'no-store',          // иначе GET-ответы (HEAD ветки) приходят из кэша
      headers: {
        'Authorization': 'Bearer ' + this.token(),
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },

  /* Тело ошибки GitHub — чтобы в интерфейсе было видно, что именно не так. */
  async errBody(r) {
    try {
      const text = await r.text();
      try {
        const j = JSON.parse(text);
        return j.message || text;
      } catch { return text.slice(0, 300); }
    } catch { return ''; }
  },

  /* Прочитать файл репозитория как текст (без токена, через raw). */
  async rawText(path) {
    const url = 'https://raw.githubusercontent.com/' + GH_REPO + '/' +
      GH_BRANCH + '/' + encodeURI(path) + '?t=' + Date.now();
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('не удалось прочитать ' + path + ' (HTTP ' + r.status + ')');
    return r.text();
  },

  async rawJSON(path) { return JSON.parse(await this.rawText(path)); },

  /* Читать файл через API (без CDN-кэша). Нужно странице загрузки: сразу после
   * коммита raw.githubusercontent ещё отдаёт старую версию site.json. */
  async apiText(path) {
    const r = await this.api('GET', '/repos/' + GH_REPO + '/contents/' + path +
      '?ref=' + GH_BRANCH + '&t=' + Date.now());
    if (!r.ok) throw new Error('не удалось прочитать ' + path + ' (HTTP ' + r.status +
      ': ' + await this.errBody(r) + ')');
    const j = await r.json();
    return new TextDecoder().decode(this.b64bytes(j.content || ''));
  },

  async apiJSON(path) { return JSON.parse(await this.apiText(path)); },

  b64bytes(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },

  /* Байты файла из репозитория: сначала raw (быстро), при промахе — через API. */
  async fileBytes(path) {
    const enc = path.split('/').map(encodeURIComponent).join('/');
    const r = await fetch('https://raw.githubusercontent.com/' + GH_REPO + '/' +
      GH_BRANCH + '/' + enc + '?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) return r.arrayBuffer();
    const a = await this.api('GET', '/repos/' + GH_REPO + '/contents/' + path +
      '?ref=' + GH_BRANCH + '&t=' + Date.now());
    if (!a.ok) throw new Error('нет файла ' + path + ' (HTTP ' + r.status + '/' + a.status + ')');
    const j = await a.json();
    if (!j.content) throw new Error('файл ' + path + ' больше 1 МБ — попробуйте через минуту');
    const bytes = this.b64bytes(j.content);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  },

  /* Ссылка на скачивание файла с сайта Pages (не через raw — быстрее и стабильнее). */
  siteFileURL(path) {
    const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
    return base + encodeURI(path);
  },

  async headSHA() {
    // ?t= — обязательный обход кэша: без него повторная попытка берёт старый SHA
    const r = await this.api('GET', '/repos/' + GH_REPO + '/git/ref/heads/' + GH_BRANCH +
      '?t=' + Date.now());
    if (!r.ok) throw new Error('ветка ' + GH_BRANCH + ' не найдена (HTTP ' + r.status +
      ': ' + await this.errBody(r) + ')');
    return (await r.json()).object.sha;
  },

  async blob(content, encoding) {
    const r = await this.api('POST', '/repos/' + GH_REPO + '/git/blobs',
      { content, encoding });           // 'utf-8' или 'base64'
    if (!r.ok) throw new Error('blob не создан (HTTP ' + r.status + ': ' + await this.errBody(r) + ')');
    return (await r.json()).sha;
  },

  /* files: [{ path, content, encoding }] — одна операция = один коммит.
   * При 422 (кто-то успел закоммитить между чтением HEAD и PATCH) перечитываем
   * HEAD заново и повторяем — теперь уже без кэша. */
  async commitFiles(files, message, attempts = 4) {
    if (!this.hasToken()) {
      throw new Error('нет GitHub-токена: откройте страницу загрузки и вставьте токен');
    }
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      try {
        const head = await this.headSHA();
        const tree = [];
        for (const f of files) {
          const sha = await this.blob(f.content, f.encoding || 'utf-8');
          tree.push({ path: f.path, mode: '100644', type: 'blob', sha });
        }
        let r = await this.api('POST', '/repos/' + GH_REPO + '/git/trees',
          { base_tree: head, tree });
        if (!r.ok) throw new Error('дерево не создано (HTTP ' + r.status + ': ' + await this.errBody(r) + ')');
        const treeSHA = (await r.json()).sha;

        r = await this.api('POST', '/repos/' + GH_REPO + '/git/commits',
          { message, tree: treeSHA, parents: [head] });
        if (!r.ok) throw new Error('коммит не создан (HTTP ' + r.status + ': ' + await this.errBody(r) + ')');
        const commitSHA = (await r.json()).sha;

        r = await this.api('PATCH', '/repos/' + GH_REPO + '/git/refs/heads/' + GH_BRANCH,
          { sha: commitSHA });
        if (!r.ok) {
          const why = await this.errBody(r);
          const e = new Error('ветка не обновлена (HTTP ' + r.status + ': ' + why + ')');
          e.retry = r.status === 409 || r.status === 422;
          throw e;
        }
        return commitSHA;
      } catch (e) {
        lastErr = e;   // конкурентный коммит — перечитываем HEAD и пробуем заново
        if (e.retry === false) throw e;
        if (i < attempts - 1) await new Promise(res => setTimeout(res, 1200 * (i + 1)));
      }
    }
    throw lastErr;
  },

  /* ArrayBuffer -> { content, encoding } для blob. */
  bytesToBlob(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < u8.length; i += CH) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    }
    return { content: btoa(bin), encoding: 'base64' };
  },

  /* Файл (File из <input type=file>) -> { content, encoding } для blob. */
  async fileToBlob(file) {
    return this.bytesToBlob(await file.arrayBuffer());
  },
};

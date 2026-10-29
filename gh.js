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
      headers: {
        'Authorization': 'Bearer ' + this.token(),
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
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

  /* Ссылка на скачивание файла с сайта Pages (не через raw — быстрее и стабильнее). */
  siteFileURL(path) {
    const base = location.href.replace(/[#?].*$/, '').replace(/[^/]*$/, '');
    return base + encodeURI(path);
  },

  async headSHA() {
    const r = await this.api('GET', '/repos/' + GH_REPO + '/git/ref/heads/' + GH_BRANCH);
    if (!r.ok) throw new Error('ветка ' + GH_BRANCH + ' не найдена (HTTP ' + r.status + ')');
    return (await r.json()).object.sha;
  },

  async blob(content, encoding) {
    const r = await this.api('POST', '/repos/' + GH_REPO + '/git/blobs',
      { content, encoding });           // 'utf-8' или 'base64'
    if (!r.ok) throw new Error('blob не создан (HTTP ' + r.status + ')');
    return (await r.json()).sha;
  },

  /* files: [{ path, content, encoding }] — одна операция = один коммит. */
  async commitFiles(files, message, attempts = 3) {
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
        if (!r.ok) throw new Error('дерево не создано (HTTP ' + r.status + ')');
        const treeSHA = (await r.json()).sha;

        r = await this.api('POST', '/repos/' + GH_REPO + '/git/commits',
          { message, tree: treeSHA, parents: [head] });
        if (!r.ok) throw new Error('коммит не создан (HTTP ' + r.status + ')');
        const commitSHA = (await r.json()).sha;

        r = await this.api('PATCH', '/repos/' + GH_REPO + '/git/refs/heads/' + GH_BRANCH,
          { sha: commitSHA });
        if (!r.ok) throw new Error('ветка не обновлена (HTTP ' + r.status + ')');
        return commitSHA;
      } catch (e) {
        lastErr = e;   // обычно — конкурентный коммит, пробуем заново
        await new Promise(res => setTimeout(res, 1500));
      }
    }
    throw lastErr;
  },

  /* Файл (File из <input type=file>) -> { content, encoding } для blob. */
  async fileToBlob(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    }
    return { content: btoa(bin), encoding: 'base64' };
  },
};

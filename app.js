/* RifeyGit — статическая версия: главная страница (после входа).
 *
 * Модель данных (data/site.json):
 *   program.versions[] = {
 *     version, pult, message, author, created_at,
 *     plc:    { path, name, size },                 // программа ПЛК
 *     panels: [{ version, hmi_type, message,        // версии панели к этой ПЛК
 *                file: { path, name, size },
 *                kit:  { path, name, size } | null }]
 *   }
 * Старый формат (files: { plc, hmi, kit }) читается и показывается так же.
 */
'use strict';

const APP_VERSION = '13';

/* ---------- утилиты ---------- */
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const nowISO = () => new Date().toISOString().slice(0, 19);

/* ---------- состояние ---------- */
let SITE = null;            // data/site.json
let USER = null;            // {login, role, full_name}
const isEngineer = () => USER && (USER.role === 'admin' || USER.role === 'engineer');

/* ---------- вход / выход ---------- */
function restoreSession() {
  try { return JSON.parse(localStorage.getItem('rifeygit_user') || 'null'); }
  catch { return null; }
}

function logout() {
  localStorage.removeItem('rifeygit_user');
  location.replace('login.html');
}

function guardOK() {
  return !!$('#dl-factory').value.trim() && !!$('#dl-purpose').value.trim();
}

function updateGuard() {
  $('#dl-ok').hidden = !guardOK();
  renderDownload();
}

function autofillEquipment() {
  const no = $('#dl-factory').value.trim().toLowerCase();
  if (!no || !SITE) return;
  const eq = SITE.equipment.find(e => e.factory_no.toLowerCase() === no);
  if (eq) {
    $('#dl-eqname').value = eq.name || '';
    $('#dl-city').value = eq.city || '';
    $('#dl-customer').value = eq.customer || '';
  }
}

/* ---------- загрузка данных ---------- */
async function loadSite() {
  SITE = await GH.siteJSON();
  SITE.programs = SITE.programs || [];
  SITE.schematics = SITE.schematics || [];
  SITE.equipment = SITE.equipment || [];
  const upd = SITE.updated ? SITE.updated.replace('T', ' ') : '';
  $('#foot-updated').textContent = upd ? 'Данные обновлены: ' + upd : 'Данные ещё не загружены';
}

/* users.json: с токеном — через API (видно правку сразу), без токена — CDN. */
async function readUsers() {
  if (GH.hasToken()) {
    try { return await GH.apiJSON('data/users.json'); } catch { /* перейдём на CDN */ }
  }
  return GH.rawJSON('data/users.json');
}

/* ---------- вкладки ---------- */
function showTab(name) {
  document.querySelectorAll('.tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.hidden = true);
  const panel = $('#tabpanel-' + name);
  if (panel) panel.hidden = false;
  if (name === 'download') renderDownload();
  if (name === 'programs') renderProgramsTab();
  if (name === 'equipment') renderEquipment();
  if (name === 'users') renderUsers();
}

/* ---------- журнал локальных скачиваний + отчёт ---------- */
function history() {
  try { return JSON.parse(localStorage.getItem('rifeygit_history') || '[]'); }
  catch { return []; }
}

function logDownload(item) {
  const h = history();
  h.unshift({
    ts: nowISO(), user: USER.login, item,
    factory: $('#dl-factory').value.trim(),
    purpose: $('#dl-purpose').value.trim(),
  });
  localStorage.setItem('rifeygit_history', JSON.stringify(h.slice(0, 200)));
}

function reportText() {
  const lines = ['RifeyGit — отчёт о скачиваниях', ''];
  for (const r of history()) {
    lines.push(`${r.ts}  ${r.user}  ${r.item}` +
      (r.factory ? `  объект: ${r.factory}` : '') +
      (r.purpose ? `  назначение: ${r.purpose}` : ''));
  }
  return lines.join('\n');
}

/* ---------- скачивание ---------- */
function canDownload() {
  return !!USER && (isEngineer() || guardOK());
}

function downloadFile(path, label) {
  if (!canDownload()) {
    alert('Сначала заполните обязательные данные для скачивания (вкладка «Скачать»).');
    return;
  }
  if (!path) { alert('Файл не найден в записи версии.'); return; }
  logDownload(label);
  triggerDownload(GH.siteFileURL(path), path.split('/').pop(), path);
}

/* Если файл ещё не попал на Pages (пересборка идёт 1–10 минут) — качаем
 * напрямую из репозитория через blob, чтобы ссылка не отдавала 404. */
async function triggerDownload(url, name, path) {
  const open = (href, downloadAttr) => {
    const a = document.createElement('a');
    a.href = href;
    if (downloadAttr) a.download = downloadAttr;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (r.ok) { open(url); return; }
  } catch { /* сайт недоступен — пробуем репозиторий */ }
  try {
    const r = await fetch(GH.rawFileURL(path), { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    const obj = URL.createObjectURL(blob);
    open(obj, name);
    setTimeout(() => URL.revokeObjectURL(obj), 60000);
  } catch (e) {
    alert('Не удалось скачать «' + name + '»: ' + e.message +
      '. Попробуйте через 1–2 минуты — файл ещё публикуется на сайте.');
  }
}

/* ---------- модель версии: старый и новый формат ---------- */
function normalizeVersion(v) {
  if (Array.isArray(v.panels)) {
    return {
      version: v.version, pult: v.pult || '', message: v.message || '',
      author: v.author || '', created_at: v.created_at || '',
      plc: v.plc || null, panels: v.panels, kit: null,
    };
  }
  const files = v.files || {};
  const panels = [];
  if (files.hmi) {
    panels.push({
      version: v.version_hmi || '', hmi_type: v.hmi_type || '', message: '',
      file: files.hmi, kit: files.kit || null,
    });
  }
  return {
    version: v.version, pult: v.pult || '', message: v.message || '',
    author: v.author || '', created_at: v.created_at || '',
    plc: files.plc || null, panels, kit: files.kit || null,
  };
}

function fileRow(kind, file, label, isKit) {
  if (!file) return '';
  return `<div class="file-row">
    <span class="file-kind${isKit ? ' kit' : ''}">${esc(kind)}</span>
    <span class="file-name" title="${esc(file.name)}">${esc(file.name)}</span>
    <button class="dl-btn${isKit ? ' kit' : ''}" data-dl="${esc(file.path)}"
            data-label="${esc(label)}">${isKit ? 'Комплект zip' : 'Скачать'}</button>
  </div>`;
}

function versionBlock(prog, raw) {
  const v = normalizeVersion(raw);
  const base = `${prog.code} ${v.version}`;
  const rows = [];
  if (v.plc) rows.push(fileRow('ПЛК', v.plc, 'ПЛК ' + base, false));
  for (const p of (v.panels || [])) {
    const pv = p.version ? ' ' + p.version : '';
    rows.push(fileRow('Панель' + pv, p.file,
      'панель ' + base + pv + (p.hmi_type ? ' (' + p.hmi_type + ')' : ''), false));
    if (p.kit) rows.push(fileRow('Комплект', p.kit, 'комплект ' + base + pv, true));
  }
  // старый общеверсионный комплект
  if (v.kit && !(v.panels || []).some(p => p.kit)) {
    rows.push(fileRow('Комплект', v.kit, 'комплект ' + base, true));
  }
  const meta = [v.pult ? 'пульт: ' + v.pult : '', v.author ? 'автор: ' + v.author : '']
    .filter(Boolean).join(' · ');
  return `<div class="ver">
    <div class="ver-head">
      <span class="ver-num">${esc(v.version)}</span>
      <span class="pg-meta">${esc(meta)}</span>
      ${v.message ? `<span class="ver-msg">${esc(v.message)}</span>` : ''}
    </div>
    ${rows.join('') || '<div class="file-row"><span class="file-name">файлов нет</span></div>'}
  </div>`;
}

function programCard(prog) {
  if (prog.deleted) return '';
  const vers = [...(prog.versions || [])].reverse();
  const rows = vers.length
    ? vers.map(v => versionBlock(prog, v)).join('')
    : '<div class="ver"><span class="ver-msg">версий пока нет</span></div>';
  const meta = [prog.plant_type, prog.target].filter(Boolean).join(' · ');
  return `<div class="pg">
    <div class="pg-head">
      <span class="pg-code">${esc(prog.code)}</span>
      <span class="pg-title">${esc(prog.name)}</span>
      ${meta ? `<span class="pg-meta">${esc(meta)}</span>` : ''}
    </div>
    ${prog.description ? `<div class="pg-meta">${esc(prog.description)}</div>` : ''}
    ${rows}
  </div>`;
}

function emptyPrograms() {
  return `<div class="empty">
    <div class="empty-title">Программ пока нет</div>
    <p class="hint">Версии появятся здесь сразу после загрузки инженером.
      ${isEngineer() ? '<a class="btn ghost" href="tools/upload.html">Загрузить версию</a>' : ''}</p>
  </div>`;
}

/* ---------- отрисовка: скачать ---------- */
function renderDownload() {
  const locked = USER.role === 'naladchik' && !guardOK();
  $('#dl-guard').hidden = USER.role !== 'naladchik';
  $('#dl-programs').innerHTML =
    (SITE.programs || []).map(programCard).join('') || emptyPrograms();
  document.querySelectorAll('#dl-programs .dl-btn').forEach(b => {
    b.disabled = locked;
    b.addEventListener('click', () => downloadFile(b.dataset.dl, b.dataset.label));
  });
}

/* ---------- отрисовка: программы и схемы ---------- */
function renderProgramsTab() {
  const locked = USER.role === 'naladchik' && !guardOK();
  $('#pg-lock').hidden = !locked;
  $('#pg-programs').innerHTML =
    (SITE.programs || []).map(programCard).join('') || emptyPrograms();
  document.querySelectorAll('#pg-programs .dl-btn').forEach(b => {
    b.disabled = locked;
    b.addEventListener('click', () => downloadFile(b.dataset.dl, b.dataset.label));
  });

  const schems = SITE.schematics || [];
  if (!schems.length) {
    $('#pg-schematics').innerHTML = '<p class="hint">Схемы пока не загружены.</p>';
  } else {
    const byPult = {};
    for (const s of schems) (byPult[s.pult] = byPult[s.pult] || []).push(s);
    $('#pg-schematics').innerHTML = Object.keys(byPult).sort().map(pult => `
      <div class="pg">
        <div class="pg-head">
          <span class="pg-code">${esc(pult)}</span>
          <span class="pg-meta">схем: ${byPult[pult].length}</span>
        </div>
        ${byPult[pult].map(s => `
          <div class="file-row">
            <span class="file-kind${s.program ? ' prog' : ''}">${s.program ? 'программа ' + esc(s.program) : 'общая'}</span>
            <span class="file-name" title="${esc(s.file.name)}">${esc(s.file.name)}</span>
            ${s.description ? `<span class="file-desc">${esc(s.description)}</span>` : ''}
            <button class="dl-btn" data-dl="${esc(s.file.path)}" data-label="схема ${esc(pult)}${s.program ? ' (' + esc(s.program) + ')' : ''}">Скачать</button>
          </div>`).join('')}
      </div>`).join('');
    document.querySelectorAll('#pg-schematics .dl-btn').forEach(b => {
      b.disabled = locked;
      b.addEventListener('click', () => downloadFile(b.dataset.dl, b.dataset.label));
    });
  }
}

/* ---------- реестр оборудования ---------- */
function renderEquipment() {
  const q = ($('#eq-search').value || '').trim().toLowerCase();
  const rows = (SITE.equipment || []).filter(e =>
    !q || [e.factory_no, e.name, e.city, e.customer].join(' ').toLowerCase().includes(q));
  $('#eq-table').innerHTML = rows.length ? `<div class="tbl-wrap"><table>
    <tr><th>Заводской №</th><th>Наименование</th><th>Пульт</th><th>Город</th><th>Заказчик</th><th>Примечание</th>${isEngineer() ? '<th></th>' : ''}</tr>
    ${rows.map(e => `<tr>
      <td>${esc(e.factory_no)}</td><td>${esc(e.name)}</td><td>${esc(e.pult)}</td>
      <td>${esc(e.city)}</td><td>${esc(e.customer)}</td><td>${esc(e.note)}</td>
      ${isEngineer() ? `<td><button class="ghost" data-edit="${esc(e.factory_no)}">&#9998;</button></td>` : ''}
    </tr>`).join('')}
  </table></div>` : '<p class="hint">Записей нет.</p>';
  $('#eq-table').querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', () => openEqForm(b.dataset.edit)));
  $('#eq-add').hidden = !isEngineer();
}

function openEqForm(factoryNo) {
  const e = factoryNo ? SITE.equipment.find(x => x.factory_no === factoryNo) : null;
  $('#eq-form').dataset.orig = factoryNo || '';
  $('#eq-form-title').textContent = e ? 'Правка: ' + e.factory_no : 'Новая запись';
  $('#ef-no').value = e ? e.factory_no : '';
  $('#ef-name').value = e ? e.name : '';
  $('#ef-pult').value = e ? e.pult : '';
  $('#ef-city').value = e ? e.city : '';
  $('#ef-customer').value = e ? e.customer : '';
  $('#ef-plant').value = e ? e.plant_type : '';
  $('#ef-note').value = e ? e.note : '';
  $('#eq-form').hidden = false;
}

async function saveEquipment(ev) {
  ev.preventDefault();
  const msg = $('#eq-msg');
  try {
    const orig = $('#eq-form').dataset.orig;
    const rec = {
      factory_no: $('#ef-no').value.trim(),
      name: $('#ef-name').value.trim(),
      pult: $('#ef-pult').value.trim(),
      city: $('#ef-city').value.trim(),
      customer: $('#ef-customer').value.trim(),
      plant_type: $('#ef-plant').value.trim(),
      note: $('#ef-note').value.trim(),
    };
    if (!rec.factory_no || !rec.name) { msg.textContent = 'Заводской № и наименование обязательны'; return; }
    if (orig && orig !== rec.factory_no &&
        SITE.equipment.some(x => x.factory_no === rec.factory_no)) {
      msg.textContent = 'Заводской № уже занят'; return;
    }
    SITE.equipment = SITE.equipment.filter(x => x.factory_no !== orig);
    SITE.equipment.push(rec);
    SITE.equipment.sort((a, b) => a.factory_no.localeCompare(b.factory_no, 'ru'));
    SITE.updated = nowISO();
    msg.textContent = 'Записываю в GitHub…';
    await GH.commitFiles(
      [{ path: 'data/site.json', content: JSON.stringify(SITE, null, 2) }],
      `реестр: ${orig ? 'правка' : 'добавление'} ${rec.factory_no}`);
    msg.textContent = 'Готово. Сайт обновится на Pages за 1–10 минут.';
    $('#eq-form').hidden = true;
    renderEquipment();
  } catch (e) { msg.textContent = 'Ошибка: ' + e.message; }
}

/* ---------- пользователи ---------- */
function renderUsers() {
  readUsers().then(data => {
    $('#us-list').innerHTML = `<h3>Пользователи</h3><div class="tbl-wrap"><table>
      <tr><th>Логин</th><th>ФИО / подпись</th><th>Роль</th><th>Активен</th><th></th></tr>
      ${data.users.map(u => `<tr>
        <td>${esc(u.login)}</td><td>${esc(u.full_name || '')}</td>
        <td>${u.role === 'admin' ? 'Администратор' : u.role === 'engineer' ? 'Инженер-программист' : 'Наладчик'}</td>
        <td>${u.active === false ? 'нет' : 'да'}</td>
        <td><button class="ghost" data-toggle="${esc(u.login)}">${u.active === false ? 'включить' : 'отключить'}</button></td>
      </tr>`).join('')}
    </table></div>`;
    $('#us-list').querySelectorAll('[data-toggle]').forEach(b =>
      b.addEventListener('click', () => toggleUser(b.dataset.toggle)));
    $('#user-list').innerHTML = data.users.map(u => `<option value="${esc(u.login)}">`).join('');
  });
}

async function mutateUsers(fn, msgSel, what) {
  const msg = $(msgSel);
  try {
    const data = await readUsers();
    fn(data.users);
    data.users.sort((a, b) => a.login.localeCompare(b.login));
    msg.textContent = 'Записываю в GitHub…';
    await GH.commitFiles(
      [{ path: 'data/users.json', content: JSON.stringify(data, null, 2) }],
      'пользователи: ' + what);
    msg.textContent = 'Готово. Изменение вступит в силу сразу (файл небольшой).';
    renderUsers();
  } catch (e) { msg.textContent = 'Ошибка: ' + e.message; }
}

async function createUser(ev) {
  ev.preventDefault();
  const login = $('#uf-login').value.trim();
  const pass = $('#uf-pass').value;
  if (!login || !pass) return;
  const salt = [...crypto.getRandomValues(new Uint8Array(8))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = await sha256hex(salt + '\0' + login.toLowerCase() + '\0' + pass);
  await mutateUsers(users => {
    if (users.some(u => u.login.toLowerCase() === login.toLowerCase()))
      throw new Error('логин «' + login + '» уже существует');
    users.push({
      login, role: $('#uf-role').value,
      full_name: $('#uf-name').value.trim(), salt, hash, active: true,
    });
  }, '#us-msg', 'создание ' + login);
  $('#uf-login').value = ''; $('#uf-pass').value = ''; $('#uf-name').value = '';
}

async function changePasswordFix(ev) {
  ev.preventDefault();
  const login = $('#pf-login').value.trim();
  const pass = $('#pf-pass').value;
  if (!login || !pass) return;
  const data = await readUsers();
  const u = data.users.find(x => x.login.toLowerCase() === login.toLowerCase());
  if (!u) { $('#pf-msg').textContent = 'логин не найден'; return; }
  const salt = [...crypto.getRandomValues(new Uint8Array(8))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = await sha256hex(salt + '\0' + u.login.toLowerCase() + '\0' + pass);
  await mutateUsers(users => {
    const t = users.find(x => x.login.toLowerCase() === login.toLowerCase());
    t.salt = salt; t.hash = hash;
  }, '#pf-msg', 'смена пароля ' + login);
  $('#pf-pass').value = '';
}

async function toggleUser(login) {
  await mutateUsers(users => {
    const u = users.find(x => x.login === login);
    u.active = u.active === false;
  }, '#us-msg', (login));
}

/* ---------- запуск ---------- */
async function enterApp() {
  $('#screen-app').hidden = false;
  $('#who-name').textContent = USER.full_name + ' (' + USER.login + ')';
  $('#avatar').textContent = (USER.full_name || USER.login).trim().charAt(0).toUpperCase();
  $('#tab-users').hidden = !isEngineer();
  $('#tab-upload').hidden = !isEngineer();
  $('#btn-report').hidden = false;
  try {
    await loadSite();
  } catch (e) {
    alert('Не удалось загрузить данные: ' + e.message);
  }
  $('#eq-list').innerHTML = (SITE.equipment || [])
    .map(e => `<option value="${esc(e.factory_no)}">`).join('');
  showTab('download');
}

function boot() {
  window.RIFEY_BOOTED = true;
  USER = restoreSession();
  if (!USER) { location.replace('login.html'); return; }

  $('#btn-logout').addEventListener('click', logout);
  document.querySelectorAll('.tab').forEach(b =>
    b.addEventListener('click', () => showTab(b.dataset.tab)));

  $('#dl-purpose').addEventListener('change', updateGuard);
  $('#dl-factory').addEventListener('input', updateGuard);
  $('#dl-factory').addEventListener('change', autofillEquipment);
  $('#eq-search').addEventListener('input', renderEquipment);
  $('#eq-add').addEventListener('click', () => openEqForm(''));
  $('#eq-cancel').addEventListener('click', () => $('#eq-form').hidden = true);
  $('#eq-form').addEventListener('submit', saveEquipment);
  $('#us-form').addEventListener('submit', createUser);
  $('#pw-form').addEventListener('submit', changePasswordFix);

  $('#btn-report').addEventListener('click', () => {
    $('#report-text').value = reportText();
    $('#dlg-report').showModal();
  });  $('#rp-close').addEventListener('click', () => $('#dlg-report').close());
  $('#rp-copy').addEventListener('click', () => {
    $('#report-text').select();
    navigator.clipboard?.writeText($('#report-text').value);
  });
  $('#rp-wa').addEventListener('click', () => {
    window.open('https://wa.me/?text=' + encodeURIComponent(reportText()), '_blank');
  });

  $('#btn-refresh').addEventListener('click', async () => {
    const btn = $('#btn-refresh');
    btn.disabled = true;
    btn.textContent = 'Обновляю…';
    try {
      await loadSite();
      $('#eq-list').innerHTML = (SITE.equipment || [])
        .map(e => `<option value="${esc(e.factory_no)}">`).join('');
      const active = document.querySelector('.tab.active');
      showTab(active ? active.dataset.tab : 'download');
    } catch (e) {
      alert('Не удалось обновить данные: ' + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Обновить данные';
    }
  });

  $('#app-ver').textContent = 'v' + APP_VERSION;
  enterApp();
}

document.addEventListener('DOMContentLoaded', boot);

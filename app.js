/* RifeyGit — статическая версия: логика daшборда (вход, вкладки, записи в GitHub). */
'use strict';

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
const canDownload = () => USER && (isEngineer() || guardOK());

/* ---------- вход ---------- */
async function doLogin(ev) {
  ev.preventDefault();
  const login = $('#login-user').value.trim();
  const pass = $('#login-pass').value;
  const err = $('#login-error');
  err.hidden = true;
  try {
    const data = await (await fetch('data/users.json', { cache: 'no-store' })).json();
    const u = data.users.find(x => x.login.toLowerCase() === login.toLowerCase() && x.active !== false);
    if (u) {
      const hash = await sha256hex(u.salt + '\0' + u.login.toLowerCase() + '\0' + pass);
      if (hash === u.hash) {
        USER = { login: u.login, role: u.role, full_name: u.full_name || u.login };
        localStorage.setItem('rifeygit_user', JSON.stringify(USER));
        return enterApp();
      }
    }
    err.textContent = 'Неверный логин или пароль';
    err.hidden = false;
  } catch (e) {
    err.textContent = 'Не удалось проверить вход: ' + e.message;
    err.hidden = false;
  }
}

function logout() {
  localStorage.removeItem('rifeygit_user');
  location.hash = '';
  location.reload();
}

/* ---------- загрузка данных ---------- */
async function loadSite() {
  SITE = await GH.rawJSON('data/site.json');
  $('#foot-updated').textContent = SITE.updated
    ? 'Данные обновлены: ' + SITE.updated.replace('T', ' ')
    : 'Данные ещё не загружены';
}

/* ---------- вкладки ---------- */
function showTab(name) {
  document.querySelectorAll('.tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.hidden = true);
  $('#tabpanel-' + name).hidden = false;
  if (name === 'download') renderDownload();
  if (name === 'programs') renderProgramsTab();
  if (name === 'equipment') renderEquipment();
  if (name === 'users') renderUsers();
}

/* ---------- блокировка скачивания (обязательные поля наладчика) ---------- */
function guardOK() {
  return !!$('#dl-purpose').value.trim();
}

function updateGuard() {
  const ok = guardOK();
  $('#dl-ok').hidden = !ok;
  if (ok) renderDownload();      // разблокировать список
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
function downloadFile(path, label) {
  if (!canDownload()) {
    alert('Сначала заполните обязательные данные для скачивания (вкладка «Скачать»).');
    return;
  }
  logDownload(label);
  const a = document.createElement('a');
  a.href = GH.siteFileURL(path);
  a.download = path.split('/').pop();
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ---------- отрисовка: программы ---------- */
function versionRow(v, files, forProgram) {
  const p = esc(v.pult || '—');
  const bits = [];
  if (files.plc) bits.push(
    `<button class="dl-btn" data-dl="${esc(files.plc.path)}" data-label="ПЛК ${esc(forProgram)} ${esc(v.version)}">ПЛК</button>`);
  if (files.hmi) bits.push(
    `<button class="dl-btn" data-dl="${esc(files.hmi.path)}" data-label="панель ${esc(forProgram)} ${esc(v.version)}">Панель</button>`);
  if (files.kit) bits.push(
    `<button class="dl-btn kit" data-dl="${esc(files.kit.path)}" data-label="комплект ${esc(forProgram)} ${esc(v.version)} (${p})">Комплект&nbsp;zip</button>`);
  return `<div class="ver">
    <span class="ver-num">${esc(v.version)}</span>
    <span class="pg-meta">пульт: ${p}</span>
    <span class="ver-msg">${esc(v.message || '')}</span>
    ${bits.join(' ')}
  </div>`;
}

function programCard(prog) {
  if (prog.deleted) return '';
  const vers = [...(prog.versions || [])].reverse();
  const rows = vers.length
    ? vers.map(v => versionRow(v, v.files || {}, prog.code)).join('')
    : '<div class="ver"><span class="ver-msg">версий пока нет</span></div>';
  return `<div class="pg">
    <div class="pg-head">
      <span class="pg-code">${esc(prog.code)}</span>
      <span>${esc(prog.name)}</span>
      <span class="pg-meta">${esc(prog.plant_type || '')} ${esc(prog.target || '')}</span>
    </div>
    ${prog.description ? `<div class="pg-meta">${esc(prog.description)}</div>` : ''}
    ${rows}
  </div>`;
}

function renderDownload() {
  const locked = USER.role === 'naladchik' && !guardOK();
  $('#dl-guard').hidden = USER.role !== 'naladchik';
  $('#dl-programs').innerHTML =
    (SITE.programs || []).map(programCard).join('') ||
    '<p class="hint">Программы ещё не загружены.</p>';
  document.querySelectorAll('#dl-programs .dl-btn').forEach(b => {
    b.disabled = locked;
    b.addEventListener('click', () => downloadFile(b.dataset.dl, b.dataset.label));
  });
}

function renderProgramsTab() {
  $('#pg-programs').innerHTML =
    (SITE.programs || []).map(programCard).join('') ||
    '<p class="hint">Программы ещё не загружены.</p>';
  document.querySelectorAll('#pg-programs .dl-btn').forEach(b =>
    b.addEventListener('click', () => downloadFile(b.dataset.dl, b.dataset.label)));

  // схемы: общие по пульту + привязанные к программе
  const schems = SITE.schematics || [];
  if (!schems.length) {
    $('#pg-schematics').innerHTML = '<p class="hint">Схемы пока не загружены.</p>';
  } else {
    const byPult = {};
    for (const s of schems) (byPult[s.pult] = byPult[s.pult] || []).push(s);
    $('#pg-schematics').innerHTML = Object.keys(byPult).map(pult => `
      <div class="pg">
        <div class="pg-head"><span class="pg-code">${esc(pult)}</span></div>
        ${byPult[pult].map(s => `
          <div class="ver">
            <span class="ver-msg">${esc(s.file.name)}${s.program ? ' (программа ' + esc(s.program) + ')' : ' (общая)'}${s.description ? ' — ' + esc(s.description) : ''}</span>
            <button class="dl-btn" data-dl="${esc(s.file.path)}" data-label="схема ${esc(pult)}">Скачать</button>
          </div>`).join('')}
      </div>`).join('');
    document.querySelectorAll('#pg-schematics .dl-btn').forEach(b =>
      b.addEventListener('click', () => downloadFile(b.dataset.dl, b.dataset.label)));
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
  GH.rawJSON('data/users.json').then(data => {
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
    const data = await GH.rawJSON('data/users.json');
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
  const data = await GH.rawJSON('data/users.json');
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
  $('#screen-login').hidden = true;
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
  // показ/скрытие пароля
  document.querySelectorAll('[data-eye]').forEach(b => b.addEventListener('click', () => {
    const inp = document.getElementById(b.dataset.eye);
    inp.type = inp.type === 'password' ? 'text' : 'password';
  }));

  $('#login-form').addEventListener('submit', doLogin);
  $('#btn-logout').addEventListener('click', logout);
  document.querySelectorAll('.tab').forEach(b =>
    b.addEventListener('click', () => showTab(b.dataset.tab)));

  $('#dl-purpose').addEventListener('change', updateGuard);
  $('#dl-factory').addEventListener('change', autofillEquipment);
  $('#eq-search').addEventListener('input', renderEquipment);
  $('#eq-add').addEventListener('click', () => openEqForm(''));
  $('#eq-cancel').addEventListener('click', () => $('#eq-form').hidden = true);
  $('#eq-form').addEventListener('submit', saveEquipment);
  $('#us-form').addEventListener('submit', createUser);
  $('#pw-form').addEventListener('submit', changePasswordFix);

  // отчёт
  $('#btn-report').addEventListener('click', () => {
    $('#report-text').value = reportText();
    $('#dlg-report').showModal();
  });
  $('#rp-close').addEventListener('click', () => $('#dlg-report').close());
  $('#rp-copy').addEventListener('click', () => {
    $('#report-text').select();
    navigator.clipboard?.writeText($('#report-text').value);
  });
  $('#rp-wa').addEventListener('click', () => {
    window.open('https://wa.me/?text=' + encodeURIComponent(reportText()), '_blank');
  });

  // восстановление сессии
  try {
    const s = JSON.parse(localStorage.getItem('rifeygit_user') || 'null');
    if (s && s.login) { USER = s; enterApp(); return; }
  } catch { /* нет сессии */ }
}

document.addEventListener('DOMContentLoaded', boot);

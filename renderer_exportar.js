let ipc = null;
try {
  if (typeof window !== 'undefined' && window.electronAPI) {
    ipc = window.electronAPI;
  }
} catch (error) {
  ipc = null;
}

let currentUser = null;
let alumnos = [];
const savedExport = sessionStorage.getItem('selectedExportAlumnos');
let selectedIds = new Set(savedExport ? JSON.parse(savedExport) : []);

function saveSelectedIds() {
  sessionStorage.setItem('selectedExportAlumnos', JSON.stringify(Array.from(selectedIds)));
}
const EXPORT_FOTO_BASE = 'C:\\IDCARDDESIGN\\DATOS\\';

function isMaintenanceUser() {
  if (!currentUser) return false;
  const role = String(currentUser.rol || '').trim().toLowerCase();
  const username = String(currentUser.username || '').trim().toLowerCase();
  return role === 'superadmin' || role === 'superusuario' || username === 'tecnico' || username === 'mantenimiento';
}

function isAdminUser() {
  return !!(currentUser && String(currentUser.rol || '').trim().toLowerCase() === 'admin');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getActiveNavIds() {
  const page = (document.getElementById('dashboard')?.dataset?.page || '').toLowerCase();
  if (page === 'exportar_alumnos') return ['nav-export-root', 'nav-export-alumnos'];
  if (page === 'exportar_empleados') return ['nav-export-root', 'nav-export-empleados'];
  return [];
}

async function loadSidebar() {
  const slot = document.getElementById('sidebar-slot');
  if (!slot) return;

  try {
    const response = await fetch('sidebar.html');
    slot.innerHTML = await response.text();
  } catch (error) {
    slot.innerHTML = '<div class="p-3 border-end">No se pudo cargar el sidebar.</div>';
    return;
  }

  const activeIds = getActiveNavIds();
  activeIds.forEach((id) => {
    const link = document.getElementById(id);
    if (link) link.classList.add('active');
  });

  if (activeIds.length) {
    const exportSubmenu = document.getElementById('nav-export-submenu');
    const exportRoot = document.getElementById('nav-export-root');
    if (exportSubmenu) exportSubmenu.classList.add('show');
    if (exportRoot) exportRoot.setAttribute('aria-expanded', 'true');
  }
}

function applySensitiveConfigVisibility() {
  const isSuperAdmin = isMaintenanceUser();
  const isAdmin = isAdminUser();
  const configSection = document.getElementById('nav-config-section');
  if (configSection) {
    configSection.style.display = (isAdmin || isSuperAdmin) ? '' : 'none';
  }
  const visibility = {
    'nav-config-item-carreras': isAdmin || isSuperAdmin,
    'nav-config-item-usuarios': isAdmin || isSuperAdmin,
    'nav-config-item-respaldo': isAdmin || isSuperAdmin,
    'nav-config-item-planteles': isSuperAdmin,
    'nav-config-item-bd': isSuperAdmin,
    'nav-config-item-sql': isSuperAdmin
  };

  Object.entries(visibility).forEach(([id, canSee]) => {
    const item = document.getElementById(id);
    if (item) item.style.display = canSee ? '' : 'none';
  });
}

function setupLogout() {
  const logoutBtn = document.getElementById('nav-logout');
  if (!logoutBtn) return;
  logoutBtn.addEventListener('click', (event) => {
    event.preventDefault();
    if (!ipc) {
      alert('No hay comunicacion IPC con Electron.');
      return;
    }
    ipc.send('logout');
  });
}

function renderCurrentUserSidebar() {
  const nameEl = document.getElementById('sidebar-user-name');
  const roleEl = document.getElementById('sidebar-user-role');
  if (!nameEl || !roleEl) return;

  if (!currentUser) {
    nameEl.textContent = 'Invitado';
    roleEl.textContent = 'Sin sesion';
    return;
  }

  nameEl.textContent = currentUser.nombre_completo || currentUser.username || 'Usuario';
  roleEl.textContent = `Rol: ${currentUser.rol || 'consulta'}`;
}

function toggleConfigMenuVisibility() {
  const configSection = document.getElementById('nav-config-section');
  if (!configSection) return;
  configSection.style.display = (isAdminUser() || isMaintenanceUser()) ? '' : 'none';
}

function fullName(alumno) {
  return [alumno.nombres, alumno.apellido_paterno, alumno.apellido_materno]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' ');
}

function carreraLabel(alumno) {
  return String(alumno.carrera_nombre || alumno.carrera || '').trim();
}

function fotoFileName(alumno) {
  const raw = String(alumno.foto || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function fotoExportPath(alumno) {
  const name = fotoFileName(alumno);
  return name ? `${EXPORT_FOTO_BASE}${name}` : '';
}

function queryMatch(alumno, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const searchable = [alumno.curp, fullName(alumno), carreraLabel(alumno)]
    .map((x) => String(x || '').toLowerCase())
    .join(' ');
  return searchable.includes(q);
}

function setStatus(type, message) {
  if (window.showToast) {
    window.showToast(type, message);
  }
}

function clearStatus() {
  const box = document.getElementById('export-status');
  if (!box) return;
  box.classList.add('d-none');
  box.textContent = '';
}

function renderSelectedTable() {
  const tbody = document.getElementById('selected-table-body');
  const exportBtn = document.getElementById('btn-export-zip');
  const clearBtn = document.getElementById('btn-clear-list');
  if (!tbody) return;

  const selected = alumnos.filter((a) => selectedIds.has(Number(a.id)));
  exportBtn.disabled = selected.length === 0;
  if (clearBtn) clearBtn.disabled = selected.length === 0;

  if (!selected.length) {
    tbody.innerHTML = `
  <tr>
    <td colspan="12">
      <div class="empty-state">
        <i class="bi bi-inbox"></i>
        <h5>Aun no hay registros</h5>
        <p>No se encontraron datos para mostrar en esta vista.</p>
      </div>
    </td>
  </tr>
`;
    return;
  }

  tbody.innerHTML = selected.map((alumno) => `
    <tr>
      <td>${escapeHtml(alumno.nombres)}</td>
      <td>${escapeHtml(alumno.apellido_paterno)}</td>
      <td>${escapeHtml(alumno.apellido_materno)}</td>
      <td>${escapeHtml(carreraLabel(alumno))}</td>
      <td>${escapeHtml(alumno.turno)}</td>
      <td class="d-none">${escapeHtml(alumno.plantel_nombre || alumno.plantel_id)}</td>
      <td>${escapeHtml(alumno.curp)}</td>
      <td>${escapeHtml(alumno.no_control)}</td>
      <td class="d-none">${escapeHtml(alumno.clave)}</td>
      <td class="d-none">${escapeHtml(fotoExportPath(alumno))}</td>
      <td class="d-none">${escapeHtml(alumno.contacto_emergencia)}</td>
      <td><button class="btn btn-danger btn-sm remove-selected" data-id="${escapeHtml(alumno.id)}">Quitar</button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.remove-selected').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedIds.delete(Number(btn.dataset.id)); saveSelectedIds();
      renderSelectedTable();
      renderSuggestions();
    });
  });
}

function renderSuggestions() {
  const search = document.getElementById('export-search');
  const list = document.getElementById('export-suggestions');
  const emptyHint = document.getElementById('suggestions-empty');
  if (!search || !list || !emptyHint) return;

  const query = search.value.trim();
  const matches = alumnos
    .filter((a) => !selectedIds.has(Number(a.id)))
    .filter((a) => queryMatch(a, query))
    .slice(0, 30);

  if (!query) {
    list.innerHTML = '';
    emptyHint.textContent = 'Empieza a escribir para ver coincidencias.';
    return;
  }

  if (!matches.length) {
    list.innerHTML = '';
    emptyHint.textContent = 'No hay coincidencias con ese filtro.';
    return;
  }

  emptyHint.textContent = `${matches.length} coincidencia(s). Selecciona para agregar.`;
  list.innerHTML = matches.map((alumno) => `
    <li class="list-group-item d-flex justify-content-between align-items-start gap-2">
      <div>
        <div><strong>CURP:</strong> ${escapeHtml(alumno.curp)}</div>
        <div><strong>Nombre:</strong> ${escapeHtml(fullName(alumno))}</div>
        <div><strong>Carrera:</strong> ${escapeHtml(carreraLabel(alumno))}</div>
      </div>
      <button class="btn btn-primary btn-sm add-selected" data-id="${escapeHtml(alumno.id)}">Agregar</button>
    </li>
  `).join('');

  list.querySelectorAll('.add-selected').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedIds.add(Number(btn.dataset.id)); saveSelectedIds();
      clearStatus();
      renderSelectedTable();
      renderSuggestions();
    });
  });
}

function parseIdExpression(expression) {
  const text = String(expression || '').trim();
  if (!text) {
    return { ok: false, message: 'Ingresa IDs en formato 1-10,13.' };
  }

  const tokens = text.split(',').map((x) => x.trim()).filter(Boolean);
  if (!tokens.length) {
    return { ok: false, message: 'Ingresa IDs en formato 1-10,13.' };
  }

  const ids = new Set();

  for (const token of tokens) {
    if (/^\d+$/.test(token)) {
      const value = Number(token);
      if (!value || Number.isNaN(value)) {
        return { ok: false, message: `ID invalido: ${token}` };
      }
      ids.add(value);
      continue;
    }

    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!rangeMatch) {
      return { ok: false, message: `Formato invalido: ${token}` };
    }

    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (!start || !end || Number.isNaN(start) || Number.isNaN(end)) {
      return { ok: false, message: `Rango invalido: ${token}` };
    }

    const min = Math.min(start, end);
    const max = Math.max(start, end);
    for (let i = min; i <= max; i += 1) {
      ids.add(i);
    }
  }

  return { ok: true, ids: Array.from(ids).sort((a, b) => a - b) };
}

function addSelectedByIdRange() {
  const input = document.getElementById('id-range-expression');
  if (!input) return;

  clearStatus();
  const parsed = parseIdExpression(input.value);
  if (!parsed.ok) {
    setStatus('warning', parsed.message || 'Expresion de IDs invalida.');
    return;
  }

  const availableIds = new Set(alumnos.map((alumno) => Number(alumno.id)).filter((id) => !Number.isNaN(id)));
  let added = 0;

  parsed.ids.forEach((id) => {
    if (availableIds.has(id) && !selectedIds.has(id)) {
      selectedIds.add(id); saveSelectedIds();
      added += 1;
    }
  });

  const missing = parsed.ids.filter((id) => !availableIds.has(id));

  renderSelectedTable();
  renderSuggestions();

  if (!added) {
    if (missing.length) {
      const preview = missing.slice(0, 8).join(', ');
      setStatus('warning', `No se agregaron registros. IDs no encontrados: ${preview}${missing.length > 8 ? '...' : ''}.`);
      return;
    }
    setStatus('warning', 'No se agregaron nuevos registros (ya estaban seleccionados).');
    return;
  }

  if (missing.length) {
    const preview = missing.slice(0, 8).join(', ');
    setStatus('success', `Se agregaron ${added} registro(s). IDs no encontrados: ${preview}${missing.length > 8 ? '...' : ''}.`);
    return;
  }

  setStatus('success', `Se agregaron ${added} registro(s).`);
}

async function cargarAlumnos() {
  if (!ipc) {
    setStatus('danger', 'No hay comunicacion IPC con Electron.');
    return;
  }
  toggleConfigMenuVisibility();

  const response = await ipc.invoke('get-alumnos');
  if (!response || !response.success) {
    setStatus('danger', response?.error || 'No se pudieron cargar los alumnos.');
    return;
  }

  alumnos = Array.isArray(response.data) ? response.data : [];
  renderSuggestions();
  renderSelectedTable();
}

async function exportSelected() {
  clearStatus();
  if (!ipc) {
    setStatus('danger', 'No hay comunicacion IPC con Electron.');
    return;
  }

  const ids = Array.from(selectedIds);
  if (!ids.length) {
    setStatus('warning', 'Selecciona al menos un registro para exportar.');
    return;
  }

  const selectedRecords = alumnos.filter(a => ids.some(id => String(id) === String(a.id)));
  const withoutPhoto = selectedRecords.filter(a => !a.foto || String(a.foto).trim() === '' || String(a.foto).trim() === 'null');
  if (withoutPhoto.length > 0) {
    
    const modalEl = document.getElementById('missingPhotosModal');
    const listEl = document.getElementById('missingPhotosList');
    if (modalEl && listEl) {
      listEl.innerHTML = '';
      withoutPhoto.forEach(a => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center list-group-item-danger';
        li.innerHTML = `<span class="fw-bold">${escapeHtml(a.nombres)} ${escapeHtml(a.apellido_paterno)} ${escapeHtml(a.apellido_materno)}</span><span class="badge bg-danger rounded-pill">${escapeHtml(a.curp || a.id)}</span>`;
        listEl.appendChild(li);
      });
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
    return;
  }

  const result = await ipc.invoke('export-selected-alumnos-zip', { ids });
  if (!result || !result.success) {
    setStatus('danger', result?.error || 'No se pudo generar el ZIP.');
    return;
  }

  setStatus('success', `ZIP generado correctamente con ${result.recordsCount} registro(s) y ${result.photosCount} foto(s). Archivo: ${result.filePath}`);
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSidebar();
  setupLogout();

  if (ipc) {
    currentUser = await ipc.invoke('get-current-user');
  }
  renderCurrentUserSidebar();
  applySensitiveConfigVisibility();

  const search = document.getElementById('export-search');
  const exportBtn = document.getElementById('btn-export-zip');
  const clearBtn = document.getElementById('btn-clear-list');
  const addRangeBtn = document.getElementById('btn-add-id-range');

  if (search) {
    search.addEventListener('input', () => {
      clearStatus();
      renderSuggestions();
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', exportSelected);
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      selectedIds.clear(); saveSelectedIds();
      clearStatus();
      renderSelectedTable();
      renderSuggestions();
    });
  }

  if (addRangeBtn) {
    addRangeBtn.addEventListener('click', addSelectedByIdRange);
  }

  const idExpressionInput = document.getElementById('id-range-expression');
  if (idExpressionInput) {
    idExpressionInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addSelectedByIdRange();
      }
    });
  }

  await cargarAlumnos();
});






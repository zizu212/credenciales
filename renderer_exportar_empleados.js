let ipc = null;
try {
  if (typeof window !== 'undefined' && window.electronAPI) {
    ipc = window.electronAPI;
  }
} catch (error) {
  ipc = null;
}

let currentUser = null;
let empleados = [];
const savedExport = sessionStorage.getItem('selectedExportEmpleados');
let selectedIds = new Set(savedExport ? JSON.parse(savedExport) : []);

function saveSelectedIds() {
  sessionStorage.setItem('selectedExportEmpleados', JSON.stringify(Array.from(selectedIds)));
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
  if (page === 'exportar_empleados') return ['nav-export-root', 'nav-export-empleados'];
  if (page === 'exportar_alumnos') return ['nav-export-root', 'nav-export-alumnos'];
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

function fullName(empleado) {
  return [empleado.nombres, empleado.apellido_paterno, empleado.apellido_materno]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(' ');
}

function puestoLabel(empleado) {
  return String(empleado.puesto || '').trim();
}

function fotoFileName(empleado) {
  const raw = String(empleado.foto || '').trim().replace(/\\/g, '/');
  if (!raw) return '';
  const parts = raw.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function fotoExportPath(empleado) {
  const name = fotoFileName(empleado);
  return name ? `${EXPORT_FOTO_BASE}${name}` : '';
}

function queryMatch(empleado, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const searchable = [empleado.curp, fullName(empleado), puestoLabel(empleado)]
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

  const selected = empleados.filter((e) => selectedIds.has(Number(e.id)));
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

  tbody.innerHTML = selected.map((empleado) => `
    <tr>
      <td>${escapeHtml(empleado.nombres)}</td>
      <td>${escapeHtml(empleado.apellido_paterno)}</td>
      <td>${escapeHtml(empleado.apellido_materno)}</td>
      <td>${escapeHtml(empleado.puesto)}</td>
      <td>${escapeHtml(empleado.turno)}</td>
      <td class="d-none">${escapeHtml(empleado.plantel_nombre || empleado.plantel_id)}</td>
      <td>${escapeHtml(empleado.curp)}</td>
      <td>${escapeHtml(empleado.numero_empleado)}</td>
      <td class="d-none">${escapeHtml(empleado.plantel_cct)}</td>
      <td class="d-none">${escapeHtml(fotoExportPath(empleado))}</td>
      <td class="d-none">${escapeHtml(empleado.telefono)}</td>
      <td><button class="btn btn-danger btn-sm remove-selected" data-id="${escapeHtml(empleado.id)}">Quitar</button></td>
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
  const matches = empleados
    .filter((e) => !selectedIds.has(Number(e.id)))
    .filter((e) => queryMatch(e, query))
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
  list.innerHTML = matches.map((empleado) => `
    <li class="list-group-item d-flex justify-content-between align-items-start gap-2">
      <div>
        <div><strong>CURP:</strong> ${escapeHtml(empleado.curp)}</div>
        <div><strong>Nombre:</strong> ${escapeHtml(fullName(empleado))}</div>
        <div><strong>Puesto:</strong> ${escapeHtml(puestoLabel(empleado))}</div>
      </div>
      <button class="btn btn-primary btn-sm add-selected" data-id="${escapeHtml(empleado.id)}">Agregar</button>
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

async function cargarEmpleados() {
  if (!ipc) {
    setStatus('danger', 'No hay comunicacion IPC con Electron.');
    return;
  }
  toggleConfigMenuVisibility();

  const response = await ipc.invoke('get-empleados');
  if (!response || !response.success) {
    setStatus('danger', response?.error || 'No se pudieron cargar los empleados.');
    return;
  }

  empleados = Array.isArray(response.data) ? response.data : [];
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

  const selectedRecords = empleados.filter(a => ids.some(id => String(id) === String(a.id)));
  const withoutPhoto = selectedRecords.filter(a => !a.foto || String(a.foto).trim() === '' || String(a.foto).trim() === 'null');
  if (withoutPhoto.length > 0) {
    
    const modalEl = document.getElementById('missingPhotosModal');
    const listEl = document.getElementById('missingPhotosList');
    if (modalEl && listEl) {
      listEl.innerHTML = '';
      withoutPhoto.forEach(a => {
        const li = document.createElement('li');
        li.className = 'list-group-item d-flex justify-content-between align-items-center list-group-item-danger';
        li.innerHTML = `<span class="fw-bold">${escapeHtml(a.nombres)} ${escapeHtml(a.apellido_paterno)} ${escapeHtml(a.apellido_materno)}</span><span class="badge bg-danger rounded-pill">ID: ${escapeHtml(a.id)}</span>`;
        listEl.appendChild(li);
      });
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
    return;
  }

  const result = await ipc.invoke('export-selected-empleados-zip', { ids });
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

  await cargarEmpleados();
});





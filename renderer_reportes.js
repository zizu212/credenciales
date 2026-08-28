let ipc = null;
try {
  if (typeof window !== 'undefined' && window.electronAPI) {
    ipc = window.electronAPI;
  }
} catch (error) {
  ipc = null;
}

let currentUser = null;
let loadingReportes = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('es-MX');
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

  const active = document.getElementById('nav-reportes');
  if (active) active.classList.add('active');
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
  configSection.style.display = currentUser && currentUser.rol === 'admin' ? '' : 'none';
}

async function cargarReportes() {
  if (loadingReportes) return;
  const tbody = document.getElementById('reportes-table-body');
  const refreshBtn = document.getElementById('btn-refresh-reportes');
  if (!tbody) return;

  loadingReportes = true;
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Actualizando...';
  }

  try {
    if (!ipc) {
      tbody.innerHTML = `
  <tr><td colspan="6" class="text-danger text-center">No hay comunicacion IPC con Electron.</td></tr>';
      return;
    }

    tbody.innerHTML = `
  <tr><td colspan="6" class="text-center text-muted">Cargando registros...</td></tr>';

    const response = await ipc.invoke('get-registros-exportacion');
    if (!response || !response.success) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center">${escapeHtml(response?.error || 'No se pudo cargar el reporte.')}</td></tr>`;
      return;
    }

    const rows = Array.isArray(response.data) ? response.data : [];
    if (!rows.length) {
      tbody.innerHTML = `
  <tr><td colspan="6" class="text-center text-muted">Aun no hay registros de exportacion.</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.id)}</td>
        <td>${escapeHtml(row.nombre_archivo)}</td>
        <td>${escapeHtml(row.cantidad_registros)}</td>
        <td>${escapeHtml(row.tipo_exportacion)}</td>
        <td>${escapeHtml(row.usuario_creador)}</td>
        <td>${escapeHtml(formatDateTime(row.created_at))}</td>
      </tr>
    `).join('');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center">${escapeHtml(error.message || 'Error al actualizar reportes.')}</td></tr>`;
  } finally {
    loadingReportes = false;
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = 'Actualizar';
    }
  }
}

function setupRefreshButton() {
  const refreshBtn = document.getElementById('btn-refresh-reportes');
  if (!refreshBtn) return;

  refreshBtn.addEventListener('click', async () => {
    await cargarReportes();
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSidebar();
  setupLogout();
  setupRefreshButton();

  if (ipc) {
    currentUser = await ipc.invoke('get-current-user');
  }
  renderCurrentUserSidebar();
  toggleConfigMenuVisibility();
  await cargarReportes();
});


let ipc = null;
try {
  if (typeof window !== 'undefined' && window.electronAPI) {
    ipc = window.electronAPI;
  }
} catch (error) {
  ipc = null;
}

let currentUser = null;
let carreras = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(type, message) {
  if (window.showToast) {
    window.showToast(type, message);
  }
}

function clearStatus() {
  const box = document.getElementById('carrera-status');
  if (!box) return;
  box.classList.add('d-none');
  box.textContent = '';
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

  const activeIds = ['nav-config-root', 'nav-config-carreras'];
  activeIds.forEach((id) => {
    const link = document.getElementById(id);
    if (link) link.classList.add('active');
  });

  const submenu = document.getElementById('nav-config-submenu');
  const root = document.getElementById('nav-config-root');
  if (submenu) submenu.classList.add('show');
  if (root) root.setAttribute('aria-expanded', 'true');
}

function resetForm() {
  const form = document.getElementById('carrera-form');
  if (form) form.reset();
  const idInput = document.getElementById('carrera-id');
  if (idInput) idInput.value = '';
}

function renderCarreras() {
  const tbody = document.getElementById('carreras-body');
  if (!tbody) return;

  if (!carreras.length) {
    tbody.innerHTML = `
  <tr><td colspan="3" class="text-center text-muted">No hay carreras registradas.</td></tr>';
    return;
  }

  tbody.innerHTML = carreras.map((carrera) => `
    <tr>
      <td>${escapeHtml(carrera.id)}</td>
      <td>${escapeHtml(carrera.nombre_carrera)}</td>
      <td>
        <button class="btn btn-sm btn-warning btn-edit" data-id="${escapeHtml(carrera.id)}" title="Editar"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-danger btn-del" data-id="${escapeHtml(carrera.id)}" title="Eliminar"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const record = carreras.find((x) => Number(x.id) === id);
      if (!record) return;
      document.getElementById('carrera-id').value = String(record.id);
      document.getElementById('carrera-nombre').value = record.nombre_carrera || '';
      clearStatus();
    });
  });

  tbody.querySelectorAll('.btn-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      if (!id || Number.isNaN(id)) return;
      if (!(await window.bootstrapConfirm('¿Deseas eliminar esta carrera?'))) return;

      const result = await ipc.invoke('delete-carrera', { id });
      if (!result || !result.success) {
        setStatus('danger', result?.error || 'No se pudo eliminar la carrera.');
        return;
      }
      setStatus('success', 'Carrera eliminada correctamente.');
      await cargarCarreras();
    });
  });
}

async function cargarCarreras() {
  const response = await ipc.invoke('get-carreras');
  if (!response || !response.success) {
    setStatus('danger', response?.error || 'No se pudieron cargar las carreras.');
    carreras = [];
    renderCarreras();
    return;
  }
  carreras = Array.isArray(response.data) ? response.data : [];
  renderCarreras();
}

function setupForm() {
  const form = document.getElementById('carrera-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus();

    const id = Number(document.getElementById('carrera-id').value || 0);
    const nombre = document.getElementById('carrera-nombre').value.trim();

    if (!nombre) {
      setStatus('warning', 'Ingresa el nombre de la carrera.');
      return;
    }

    const channel = id ? 'update-carrera' : 'save-carrera';
    const payload = id ? { id, nombre_carrera: nombre } : { nombre_carrera: nombre };
    const result = await ipc.invoke(channel, payload);

    if (!result || !result.success) {
      setStatus('danger', result?.error || 'No se pudo guardar la carrera.');
      return;
    }

    setStatus('success', id ? 'Carrera actualizada correctamente.' : 'Carrera registrada correctamente.');
    resetForm();
    await cargarCarreras();
  });
}

async function guardAdminAccess() {
  if (!ipc) {
    setStatus('danger', 'No hay comunicacion IPC con Electron.');
    return false;
  }

  currentUser = await ipc.invoke('get-current-user');
  renderCurrentUserSidebar();

  if (!currentUser || currentUser.rol !== 'admin') {
    setStatus('danger', 'Acceso restringido. Solo administradores pueden configurar catalogos.');
    const form = document.getElementById('carrera-form');
    if (form) form.style.display = 'none';
    return false;
  }

  return true;
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSidebar();
  setupLogout();
  setupForm();

  const hasAccess = await guardAdminAccess();
  if (!hasAccess) return;

  await cargarCarreras();
});


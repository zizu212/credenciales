let ipc = null;
try {
  if (typeof window !== 'undefined' && window.electronAPI) {
    ipc = window.electronAPI;
  }
} catch (error) {
  ipc = null;
}

let currentUser = null;
let planteles = [];

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
  const box = document.getElementById('plantel-status');
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

  const activeIds = ['nav-config-root', 'nav-config-planteles'];
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
  const form = document.getElementById('plantel-form');
  if (form) form.reset();
  const idInput = document.getElementById('plantel-id');
  if (idInput) idInput.value = '';
}

function renderPlanteles() {
  const tbody = document.getElementById('planteles-body');
  if (!tbody) return;

  if (!planteles.length) {
    tbody.innerHTML = `
  <tr><td colspan="5" class="text-center text-muted">No hay planteles registrados.</td></tr>';
    return;
  }

  tbody.innerHTML = planteles.map((plantel) => `
    <tr>
      <td>${escapeHtml(plantel.id)}</td>
      <td>${escapeHtml(plantel.nombre)}</td>
      <td>${escapeHtml(plantel.cct)}</td>
      <td>${escapeHtml(plantel.telefono || '')}</td>
      <td>
        <button class="btn btn-sm btn-warning btn-edit" data-id="${escapeHtml(plantel.id)}" title="Editar"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-danger btn-del" data-id="${escapeHtml(plantel.id)}" title="Eliminar"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const record = planteles.find((x) => Number(x.id) === id);
      if (!record) return;
      document.getElementById('plantel-id').value = String(record.id);
      document.getElementById('plantel-nombre').value = record.nombre || '';
      document.getElementById('plantel-cct').value = record.cct || '';
      document.getElementById('plantel-telefono').value = record.telefono || '';
      clearStatus();
    });
  });

  tbody.querySelectorAll('.btn-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      if (!id || Number.isNaN(id)) return;
      if (!(await window.bootstrapConfirm('¿Deseas eliminar este plantel?'))) return;

      const result = await ipc.invoke('delete-plantel', { id });
      if (!result || !result.success) {
        setStatus('danger', result?.error || 'No se pudo eliminar el plantel.');
        return;
      }

      setStatus('success', 'Plantel eliminado correctamente.');
      await cargarPlanteles();
    });
  });
}

async function cargarPlanteles() {
  const response = await ipc.invoke('get-planteles');
  if (!response || !response.success) {
    setStatus('danger', response?.error || 'No se pudieron cargar planteles.');
    planteles = [];
    renderPlanteles();
    return;
  }

  planteles = Array.isArray(response.data) ? response.data : [];
  renderPlanteles();
}

function setupForm() {
  const form = document.getElementById('plantel-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus();

    const id = Number(document.getElementById('plantel-id').value || 0);
    const nombre = document.getElementById('plantel-nombre').value.trim();
    const cct = document.getElementById('plantel-cct').value.trim();
    const telefono = document.getElementById('plantel-telefono').value.trim();

    if (!nombre || !cct) {
      setStatus('warning', 'Nombre y CCT son obligatorios.');
      return;
    }

    const channel = id ? 'update-plantel' : 'save-plantel';
    const payload = id
      ? { id, nombre, cct, telefono }
      : { nombre, cct, telefono };

    const result = await ipc.invoke(channel, payload);
    if (!result || !result.success) {
      setStatus('danger', result?.error || 'No se pudo guardar el plantel.');
      return;
    }

    setStatus('success', id ? 'Plantel actualizado correctamente.' : 'Plantel registrado correctamente.');
    resetForm();
    await cargarPlanteles();
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
    const form = document.getElementById('plantel-form');
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

  await cargarPlanteles();
});


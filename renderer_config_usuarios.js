let ipc = null;
try {
  if (typeof window !== 'undefined' && window.electronAPI) {
    ipc = window.electronAPI;
  }
} catch (error) {
  ipc = null;
}

let currentUser = null;
let usuarios = [];
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
  const box = document.getElementById('usuario-status');
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

  const activeIds = ['nav-config-root', 'nav-config-usuarios'];
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
  const form = document.getElementById('usuario-form');
  if (form) form.reset();
  const idInput = document.getElementById('usuario-id');
  if (idInput) idInput.value = '';
}

function renderPlantelesSelect() {
  const select = document.getElementById('usuario-plantel');
  if (!select) return;

  if (!planteles.length) {
    select.innerHTML = '<option value="">Sin planteles disponibles</option>';
    return;
  }

  select.innerHTML = '<option value="">Selecciona un plantel</option>' +
    planteles.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.nombre)} (${escapeHtml(p.cct)})</option>`).join('');
}

function renderUsuarios() {
  const tbody = document.getElementById('usuarios-body');
  if (!tbody) return;

  if (!usuarios.length) {
    tbody.innerHTML = `
  <tr><td colspan="6" class="text-center text-muted">No hay usuarios registrados.</td></tr>';
    return;
  }

  tbody.innerHTML = usuarios.map((user) => `
    <tr>
      <td>${escapeHtml(user.id)}</td>
      <td>${escapeHtml(user.nombre_completo)}</td>
      <td>${escapeHtml(user.username)}</td>
      <td>${escapeHtml(user.rol)}</td>
      <td>${escapeHtml(user.plantel_nombre || user.plantel_id || '')}</td>
      <td>
        <button class="btn btn-sm btn-warning btn-edit" data-id="${escapeHtml(user.id)}" title="Editar"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-danger btn-del" data-id="${escapeHtml(user.id)}" title="Eliminar"><i class="bi bi-trash"></i></button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.btn-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.id);
      const record = usuarios.find((x) => Number(x.id) === id);
      if (!record) return;

      document.getElementById('usuario-id').value = String(record.id);
      document.getElementById('usuario-nombre').value = record.nombre_completo || '';
      document.getElementById('usuario-username').value = record.username || '';
      document.getElementById('usuario-password').value = '';
      document.getElementById('usuario-rol').value = record.rol || 'consulta';
      document.getElementById('usuario-plantel').value = record.plantel_id ? String(record.plantel_id) : '';
      clearStatus();
    });
  });

  tbody.querySelectorAll('.btn-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      if (!id || Number.isNaN(id)) return;
      if (!(await window.bootstrapConfirm('¿Deseas eliminar este usuario?'))) return;

      const result = await ipc.invoke('delete-usuario', { id });
      if (!result || !result.success) {
        setStatus('danger', result?.error || 'No se pudo eliminar el usuario.');
        return;
      }

      setStatus('success', 'Usuario eliminado correctamente.');
      await cargarUsuarios();
    });
  });
}

async function cargarUsuarios() {
  const response = await ipc.invoke('get-usuarios');
  if (!response || !response.success) {
    setStatus('danger', response?.error || 'No se pudieron cargar los usuarios.');
    usuarios = [];
    renderUsuarios();
    return;
  }

  usuarios = Array.isArray(response.data) ? response.data : [];
  renderUsuarios();
}

async function cargarPlanteles() {
  const response = await ipc.invoke('get-planteles');
  if (!response || !response.success) {
    setStatus('danger', response?.error || 'No se pudieron cargar los planteles.');
    planteles = [];
    renderPlantelesSelect();
    return;
  }

  planteles = Array.isArray(response.data) ? response.data : [];
  renderPlantelesSelect();
}

function setupForm() {
  const form = document.getElementById('usuario-form');
  if (!form) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearStatus();

    const id = Number(document.getElementById('usuario-id').value || 0);
    const nombreCompleto = document.getElementById('usuario-nombre').value.trim();
    const username = document.getElementById('usuario-username').value.trim();
    const password = document.getElementById('usuario-password').value.trim();
    const rol = document.getElementById('usuario-rol').value;
    const plantelId = Number(document.getElementById('usuario-plantel').value || 0);

    if (!nombreCompleto || !username || !plantelId || Number.isNaN(plantelId)) {
      setStatus('warning', 'Nombre, usuario y plantel son obligatorios.');
      return;
    }

    if (!id && !password) {
      setStatus('warning', 'La contrasena es obligatoria para usuarios nuevos.');
      return;
    }

    if (!id) {
      const result = await ipc.invoke('create-user', {
        nombre_completo: nombreCompleto,
        username,
        password,
        rol,
        plantel_id: plantelId
      });

      if (!result || !result.success) {
        setStatus('danger', result?.error || 'No se pudo crear el usuario.');
        return;
      }

      setStatus('success', 'Usuario creado correctamente.');
      resetForm();
      await cargarUsuarios();
      return;
    }

    const result = await ipc.invoke('update-usuario', {
      id,
      nombre_completo: nombreCompleto,
      username,
      password,
      rol,
      plantel_id: plantelId
    });

    if (!result || !result.success) {
      setStatus('danger', result?.error || 'No se pudo actualizar el usuario.');
      return;
    }

    setStatus('success', 'Usuario actualizado correctamente.');
    resetForm();
    await cargarUsuarios();
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
    setStatus('danger', 'Acceso restringido. Solo administradores pueden configurar usuarios.');
    const form = document.getElementById('usuario-form');
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
  await cargarUsuarios();
});


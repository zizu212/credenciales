document.addEventListener('DOMContentLoaded', () => {
  const ipc = window.electronAPI;
  const createUserForm = document.getElementById('create-user-form');
  const createUserError = document.getElementById('create-user-error');
  const createUserSuccess = document.getElementById('create-user-success');
  const plantelSelect = document.getElementById('new-plantel');

  const rolesValidos = ['admin', 'capturista', 'consulta'];

  function mostrarError(msg) {
    createUserError.style.display = 'block';
    createUserError.textContent = msg;
    createUserSuccess.style.display = 'none';
  }

  async function cargarPlanteles() {
    const response = await ipc.invoke('get-planteles');
    if (!response || !response.success) {
      plantelSelect.innerHTML = '<option value="">No se pudieron cargar planteles</option>';
      mostrarError((response && response.error) || 'No se pudieron cargar planteles.');
      return;
    }

    const planteles = Array.isArray(response.data) ? response.data : [];
    if (planteles.length === 0) {
      plantelSelect.innerHTML = '<option value="">No hay planteles registrados</option>';
      mostrarError('No hay planteles registrados.');
      return;
    }

    plantelSelect.innerHTML = '<option value="">Selecciona un plantel</option>' +
      planteles.map((p) => `<option value="${p.id}">${p.nombre} (${p.cct})</option>`).join('');
  }

  if (!ipc) {
    if (createUserError) {
      mostrarError('No hay comunicacion IPC con Electron.');
    }
    return;
  }

  cargarPlanteles();

  if (createUserForm) {
    createUserForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombreCompleto = document.getElementById('new-fullname').value.trim();
      const username = document.getElementById('new-username').value;
      const password = document.getElementById('new-password').value;
      const rol = document.getElementById('new-role').value;
      const plantelId = Number(document.getElementById('new-plantel').value);

      if (!rolesValidos.includes(rol)) {
        mostrarError('Selecciona un rol valido.');
        return;
      }

      if (!plantelId || Number.isNaN(plantelId)) {
        mostrarError('Selecciona un plantel valido.');
        return;
      }

      ipc.invoke('create-user', {
        nombre_completo: nombreCompleto,
        username,
        password,
        rol,
        plantel_id: plantelId
      }).then(result => {
        if (result.success) {
          createUserSuccess.style.display = 'block';
          createUserSuccess.textContent = 'Usuario creado correctamente.';
          createUserError.style.display = 'none';
          createUserForm.reset();
        } else {
          mostrarError(result.error || 'Error al crear usuario.');
        }
      });
    });
  }
});


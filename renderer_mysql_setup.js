function setStatus(message, ok = false) {
  const status = document.getElementById('status');
  if (!status) return;
  status.textContent = message;
  status.className = `msg ${ok ? 'ok' : 'error'}`;
  status.style.display = 'block';
}

function getPayload() {
  return {
    host: document.getElementById('host').value.trim(),
    port: Number(document.getElementById('port').value.trim() || 3306),
    user: document.getElementById('user').value.trim(),
    password: document.getElementById('password').value,
    database: document.getElementById('database').value.trim()
  };
}

function fillForm(config) {
  if (!config) return;
  document.getElementById('host').value = config.host || 'localhost';
  document.getElementById('port').value = Number(config.port) || 3306;
  document.getElementById('user').value = config.user || 'root';
  document.getElementById('password').value = typeof config.password === 'string' ? config.password : '';
  document.getElementById('database').value = config.database || 'credenciales';
}

document.addEventListener('DOMContentLoaded', async () => {
  const ipc = window.electronAPI;
  if (!ipc) {
    setStatus('No hay comunicacion IPC con Electron.');
    return;
  }

  try {
    const config = await ipc.invoke('get-db-config');
    fillForm(config);
  } catch (error) {
    setStatus('No se pudo cargar configuracion actual.');
  }

  const btnTest = document.getElementById('btn-test');
  const btnRetry = document.getElementById('btn-retry');

  btnTest.addEventListener('click', async () => {
    const payload = getPayload();
    const result = await ipc.invoke('setup-database', payload);
    if (!result || !result.success) {
      setStatus(`Instale/configure MySQL. Error: ${result?.error || 'conexion fallida'}`);
      return;
    }

    setStatus('Conexion correcta e inicializacion completada. Abriendo login...', true);
    setTimeout(() => {
      window.location.href = 'login.html';
    }, 600);
  });

  btnRetry.addEventListener('click', async () => {
    const result = await ipc.invoke('retry-database-init');
    if (!result || !result.success) {
      setStatus(`Instale/configure MySQL. Error: ${result?.error || 'conexion fallida'}`);
      return;
    }

    setStatus('Conexion validada con la configuracion guardada. Abriendo login...', true);
    setTimeout(() => {
      window.location.href = 'login.html';
    }, 600);
  });
});


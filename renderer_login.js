document.addEventListener('DOMContentLoaded', () => {
  const ipc = window.electronAPI;
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');
  const createUserBox = document.getElementById('login-create-user-box');

  const refreshCreateUserBox = async () => {
    if (!ipc || !createUserBox) return;
    try {
      const result = await ipc.invoke('has-users');
      const hasAdmin = Boolean(result && result.success && (result.hasAdmin || result.hasUsers));
      if (!hasAdmin) {
        window.location.replace('nuevo_usuario.html');
        return;
      }
      createUserBox.style.display = hasAdmin ? 'none' : 'block';
    } catch (error) {
      // Keep link visible if user count cannot be checked.
      createUserBox.style.display = 'block';
    }
  };

  if (!ipc) {
    if (loginError) {
      loginError.style.display = 'block';
      loginError.textContent = 'No hay comunicacion IPC con Electron.';
    }
    return;
  }

  if (createUserBox) {
    refreshCreateUserBox();
    window.addEventListener('focus', refreshCreateUserBox);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        refreshCreateUserBox();
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      ipc.invoke('verify-user', { username, password }).then(result => {
        if (result && result.success) {
          ipc.send('login-success', { user: result.user });
        } else {
          loginError.style.display = 'block';
          loginError.textContent = (result && result.error) || 'Usuario o contraseña incorrectos.';
        }
      });
    });
  }
});


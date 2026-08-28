let ipc = null;
try {
  if (typeof window !== 'undefined' && window.electronAPI) {
    ipc = window.electronAPI;
  }
} catch (error) {
  ipc = null;
}

let empleadoModal = null;
let currentEditingId = null;
let currentEditingFoto = '';
let allEmpleados = [];
let filteredEmpleados = [];
let allTurnos = [];
let allPlanteles = [];
let currentUser = null;
let currentPage = 1;
let pageSize = 20;
const CURP_REGEX = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]{2}$/;
const CROP_WIDTH = 300;
const CROP_HEIGHT = 400;

let cropperModal = null;
let cropperInstance = null;
let pendingImageObjectUrl = '';
let croppedPhotoDataUrl = '';
let croppedPhotoName = '';

function toUpperEs(value) {
  return String(value || '').trim().normalize('NFC').toLocaleUpperCase('es-MX');
}

function destroyCropper() {
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
  if (pendingImageObjectUrl) {
    URL.revokeObjectURL(pendingImageObjectUrl);
    pendingImageObjectUrl = '';
  }
}

function setPhotoCropStatus(message, isError = false) {
  const status = document.getElementById('foto-crop-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('text-danger', isError);
}

function openCropperForFile(file) {
  if (!file) return;
  if (typeof Cropper === 'undefined') {
    alert('No se pudo cargar la libreria de recorte.');
    return;
  }

  const imageElement = document.getElementById('cropper-image');
  if (!imageElement || !cropperModal) return;

  destroyCropper();
  pendingImageObjectUrl = URL.createObjectURL(file);
  imageElement.src = pendingImageObjectUrl;
  imageElement.onload = () => {
    cropperInstance = new Cropper(imageElement, {
      aspectRatio: CROP_WIDTH / CROP_HEIGHT,
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 1,
      background: false,
      responsive: true,
      cropBoxMovable: false,
      cropBoxResizable: false,
      minContainerWidth: 480,
      minContainerHeight: 520
    });
  };

  cropperModal.show();
}

function setupPhotoCropper() {
  const fileInput = document.getElementById('foto');
  const cropModalElement = document.getElementById('fotoCropModal');
  const confirmBtn = document.getElementById('crop-confirm-btn');

  if (!fileInput || !cropModalElement || !confirmBtn) return;

  cropperModal = bootstrap.Modal.getOrCreateInstance(cropModalElement);

  fileInput.addEventListener('change', () => {
    const selected = fileInput.files && fileInput.files[0];
    if (!selected) return;
    croppedPhotoDataUrl = '';
    croppedPhotoName = '';
    openCropperForFile(selected);
  });

  confirmBtn.addEventListener('click', () => {
    if (!cropperInstance) {
      alert('Selecciona una imagen para recortar.');
      return;
    }

    const canvas = cropperInstance.getCroppedCanvas({
      width: CROP_WIDTH,
      height: CROP_HEIGHT,
      fillColor: '#ffffff',
      imageSmoothingQuality: 'high'
    });

    if (!canvas) {
      alert('No se pudo generar la imagen recortada.');
      return;
    }

    croppedPhotoDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    croppedPhotoName = `empleado_${Date.now()}.jpg`;
    setPhotoCropStatus('Foto recortada lista. Se guardara con tamano uniforme de credencial.');
    cropperModal.hide();
  });

  cropModalElement.addEventListener('hidden.bs.modal', () => {
    if (!croppedPhotoDataUrl && fileInput) {
      fileInput.value = '';
      setPhotoCropStatus('Selecciona una foto para recortarla antes de guardar.');
    }
    destroyCropper();
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fotoSrc(pathValue) {
  if (!pathValue) return '';
  if (pathValue.startsWith('http://') || pathValue.startsWith('https://') || pathValue.startsWith('file://')) {
    return pathValue;
  }
  return `file://${pathValue.replace(/\\/g, '/')}`;
}

function canCreateOrEdit() {
  return currentUser && (currentUser.rol === 'admin' || currentUser.rol === 'capturista' || isMaintenanceUser());
}

function canDelete() {
  return currentUser && currentUser.rol === 'admin';
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

  const displayName = currentUser.nombre_completo || currentUser.username || 'Usuario';
  nameEl.textContent = displayName;
  roleEl.textContent = `Rol: ${currentUser.rol || 'consulta'}`;
}

function toggleConfigMenuVisibility() {
  const configSection = document.getElementById('nav-config-section');
  if (!configSection) return;
  configSection.style.display = currentUser && currentUser.rol === 'admin' ? '' : 'none';
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
    const html = await response.text();
    slot.innerHTML = html;
  } catch (error) {
    slot.innerHTML = '<div class="p-3 border-end">No se pudo cargar el sidebar.</div>';
    return;
  }

  const activeLink = document.getElementById('nav-empleados');
  if (activeLink) activeLink.classList.add('active');
}

function updatePermissionsUI() {
  const addButton = document.querySelector('[data-bs-target="#empleadoModal"]');
  if (addButton) addButton.style.display = canCreateOrEdit() ? '' : 'none';
}

function renderTurnosOptions(turnos) {
  const select = document.getElementById('turno');
  if (!select) return;
  let options = '<option value="">Selecciona un turno</option>';
  turnos.forEach((turno) => {
    options += `<option value="${escapeHtml(turno.nombre_turno)}">${escapeHtml(turno.nombre_turno)}</option>`;
  });
  select.innerHTML = options;
}

function renderPlantelesOptions(planteles) {
  const select = document.getElementById('plantel');
  if (!select) return;
  let options = '<option value="">Selecciona un plantel</option>';
  planteles.forEach((plantel) => {
    options += `<option value="${escapeHtml(plantel.id)}">${escapeHtml(plantel.nombre)} (${escapeHtml(plantel.cct)})</option>`;
  });
  select.innerHTML = options;
}

function applyLoggedUserDefaults() {
  const plantelContainer = document.getElementById('plantel')?.closest('.d-none');
  if (plantelContainer) {
    if (!currentUser || !currentUser.plantel_id) {
      plantelContainer.classList.remove('d-none');
    } else {
      plantelContainer.classList.add('d-none');
    }
  }

  const plantelSelect = document.getElementById('plantel');
  const telefonoInput = document.getElementById('telefono');
  if (!plantelSelect) return;
  const userPlantel = currentUser && currentUser.plantel_id ? Number(currentUser.plantel_id) : null;
  const userPlantelIsValid = userPlantel && allPlanteles.some((p) => Number(p.id) === userPlantel);

  if (userPlantelIsValid) {
    plantelSelect.value = String(userPlantel);
    plantelSelect.disabled = true;
  } else {
    plantelSelect.disabled = false;
    if (currentUser && currentUser.plantel_id) {
      plantelSelect.value = '';
    }
  }

  if (telefonoInput) {
    if (currentUser && currentUser.plantel_telefono) {
      telefonoInput.value = String(currentUser.plantel_telefono);
      telefonoInput.readOnly = true;
    } else {
      telefonoInput.readOnly = false;
    }
  }
}

async function cargarTurnos() {
  if (!ipc) return;
  const response = await ipc.invoke('get-turnos');
  allTurnos = response && response.success ? response.data : [];
  renderTurnosOptions(allTurnos);
}

async function cargarPlanteles() {
  if (!ipc) return;
  const response = await ipc.invoke('get-planteles');
  allPlanteles = response && response.success ? response.data : [];
  renderPlantelesOptions(allPlanteles);
  applyLoggedUserDefaults();
}

function setFormValues(emp) {
  document.getElementById('nombres').value = emp?.nombres || '';
  document.getElementById('apellido_paterno').value = emp?.apellido_paterno || '';
  document.getElementById('apellido_materno').value = emp?.apellido_materno || '';
  document.getElementById('puesto').value = emp?.puesto || '';
  document.getElementById('turno').value = emp?.turno || '';
  document.getElementById('plantel').value = emp?.plantel_id ? String(emp.plantel_id) : '';
  document.getElementById('curp').value = emp?.curp || '';
  document.getElementById('numero_empleado').value = emp?.numero_empleado || '';
  document.getElementById('telefono').value = emp?.telefono || '';
}

function resetFormToCreateMode() {
  currentEditingId = null;
  currentEditingFoto = '';
  croppedPhotoDataUrl = '';
  croppedPhotoName = '';
  destroyCropper();
  const form = document.getElementById('empleado-form');
  if (form) form.reset();
  setFormValues(null);
  applyLoggedUserDefaults();
  setPhotoCropStatus('Al seleccionar una imagen, se abrira el recorte de credencial.');
  const modalTitle = document.getElementById('empleadoModalLabel');
  const header = modalTitle ? modalTitle.closest('.modal-header') : null;
  if (header) { header.classList.remove('bg-warning', 'text-dark'); header.classList.add('bg-success', 'text-white'); modalTitle.innerHTML = '<i class="bi bi-person-plus me-2"></i>Agregar Empleado'; }
  const btnClose = header ? header.querySelector('.btn-close') : null;
  if (btnClose) { btnClose.classList.add('btn-close-white'); }
  if (modalTitle) modalTitle.textContent = 'Agregar Empleado';
}

function getFormData() {
  const userPlantel = currentUser && currentUser.plantel_id ? Number(currentUser.plantel_id) : null;
  const userPlantelIsValid = userPlantel && allPlanteles.some((p) => Number(p.id) === userPlantel);
  const userPhone = currentUser && currentUser.plantel_telefono ? String(currentUser.plantel_telefono).trim() : '';
  const plantelValue = document.getElementById('plantel').value.trim();
  return {
    nombres: toUpperEs(document.getElementById('nombres').value),
    apellido_paterno: toUpperEs(document.getElementById('apellido_paterno').value),
    apellido_materno: toUpperEs(document.getElementById('apellido_materno').value),
    puesto: toUpperEs(document.getElementById('puesto').value),
    turno: toUpperEs(document.getElementById('turno').value),
    plantel_id: userPlantelIsValid ? userPlantel : (plantelValue ? Number(plantelValue) : null),
    curp: toUpperEs(document.getElementById('curp').value),
    numero_empleado: toUpperEs(document.getElementById('numero_empleado').value),
    telefono: toUpperEs(userPhone || document.getElementById('telefono').value)
  };
}

function matchesQuery(emp, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const text = [
    emp.id,
    emp.nombres,
    emp.apellido_paterno,
    emp.apellido_materno,
    emp.puesto,
    emp.turno,
    emp.plantel_nombre,
    emp.curp,
    emp.numero_empleado,
    emp.telefono
  ].map((v) => String(v ?? '').toLowerCase()).join(' ');
  return text.includes(q);
}

function getPagedRows(rows) {
  if (pageSize === 'all') return rows;
  const n = Number(pageSize);
  const start = (currentPage - 1) * n;
  return rows.slice(start, start + n);
}

function renderPagination() {
  const nav = document.getElementById('page-nav');
  if (!nav) return;

  if (!filteredEmpleados.length || pageSize === 'all') {
    nav.innerHTML = `<span class="small text-muted">${filteredEmpleados.length} registros</span>`;
    return;
  }

  const n = Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredEmpleados.length / n));
  if (currentPage > totalPages) currentPage = totalPages;

  nav.innerHTML = `
    <button class="btn btn-secondary btn-sm" id="page-prev" ${currentPage === 1 ? 'disabled' : ''}>Anterior</button>
    <span class="small text-muted">Pagina ${currentPage} de ${totalPages}</span>
    <button class="btn btn-secondary btn-sm" id="page-next" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente</button>
  `;

  const prev = document.getElementById('page-prev');
  const next = document.getElementById('page-next');
  if (prev) prev.addEventListener('click', () => { if (currentPage > 1) { currentPage -= 1; renderTable(getPagedRows(filteredEmpleados)); renderPagination(); } });
  if (next) next.addEventListener('click', () => { if (currentPage < totalPages) { currentPage += 1; renderTable(getPagedRows(filteredEmpleados)); renderPagination(); } });
}

function renderTable(rows) {
  const tbody = document.getElementById('empleados-table-body');
  const emptyState = document.getElementById('empty-state');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `
  <tr><td colspan="12" class="text-center text-muted">Sin coincidencias.</td></tr>';
    if (emptyState) emptyState.classList.remove('d-none');
    return;
  }

  if (emptyState) emptyState.classList.add('d-none');

  let html = '';
  rows.forEach((emp) => {
    const image = emp.foto ? `<img src="${escapeHtml(fotoSrc(emp.foto))}" style="width:42px;height:42px;object-fit:cover;" class="rounded border" alt="Foto">` : '';
    html += `
      <tr>
        <td>${escapeHtml(emp.id)}</td>
        <td>${image}</td>
        <td>${escapeHtml(emp.nombres)}</td>
        <td>${escapeHtml(emp.apellido_paterno)}</td>
        <td>${escapeHtml(emp.apellido_materno)}</td>
        <td>${escapeHtml(emp.puesto)}</td>
        <td>${escapeHtml(emp.turno)}</td>
        <td class="d-none">${escapeHtml(emp.plantel_nombre || emp.plantel_id)}</td>
        <td>${escapeHtml(emp.curp)}</td>
        <td>${escapeHtml(emp.numero_empleado)}</td>
        <td>${escapeHtml(emp.telefono)}</td>
        <td>
          ${canCreateOrEdit() ? `<button class="btn btn-warning btn-sm me-1 editar-empleado" data-id="${escapeHtml(emp.id)}" title="Editar"><i class="bi bi-pencil"></i></button>` : ''}
          ${canDelete() ? `<button class="btn btn-danger btn-sm eliminar-empleado" data-id="${escapeHtml(emp.id)}" title="Eliminar"><i class="bi bi-trash"></i></button>` : ''}
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;

  tbody.querySelectorAll('.editar-empleado').forEach((btn) => btn.addEventListener('click', () => openEdit(btn.dataset.id)));
  tbody.querySelectorAll('.eliminar-empleado').forEach((btn) => btn.addEventListener('click', () => deleteEmpleado(btn.dataset.id)));
}

function applySearchFilter() {
  const q = (document.getElementById('search-input')?.value || '').trim();
  filteredEmpleados = allEmpleados.filter((emp) => matchesQuery(emp, q));
  renderTable(getPagedRows(filteredEmpleados));
  renderPagination();
}

async function cargarEmpleados() {
  if (!ipc) return;
  const response = await ipc.invoke('get-empleados');
  allEmpleados = response && response.success ? (Array.isArray(response.data) ? response.data : []) : [];
  applySearchFilter();
}

async function openEdit(id) {
  if (!canCreateOrEdit()) return;
  const emp = allEmpleados.find((x) => String(x.id) === String(id));
  if (!emp) return;
  currentEditingId = emp.id;
  currentEditingFoto = emp.foto || '';
  croppedPhotoDataUrl = '';
  croppedPhotoName = '';
  setFormValues(emp);
  setPhotoCropStatus('Si seleccionas nueva foto, podras recortarla antes de guardar.');
  const modalTitle = document.getElementById('empleadoModalLabel');
  modalTitle.innerHTML = `<i class="bi bi-pencil-square me-2"></i>Editar Empleado #${emp.id}`;
  const header = modalTitle.closest('.modal-header');
  if (header) { header.classList.remove('bg-primary', 'text-white'); header.classList.add('bg-warning', 'text-dark'); }
  const btnClose = header ? header.querySelector('.btn-close') : null;
  if (btnClose) { btnClose.classList.remove('btn-close-white'); }
  const fotoInput = document.getElementById('foto');
  if (fotoInput) fotoInput.value = '';
  empleadoModal.show();
}

async function deleteEmpleado(id) {
  if (!canDelete()) return;
  const ok = await window.bootstrapConfirm('Deseas eliminar este registro?');
  if (!ok) return;
  const result = await ipc.invoke('delete-empleado', { id: Number(id) });
  if (!result.success) {
    alert(result.error || 'No se pudo eliminar el registro.');
    return;
  }
  await cargarEmpleados();
}

async function handleSubmit(event) {
  event.preventDefault();
  if (!canCreateOrEdit()) return;

  const data = getFormData();
  const fieldSync = [
    ['nombres', data.nombres],
    ['apellido_paterno', data.apellido_paterno],
    ['apellido_materno', data.apellido_materno],
    ['puesto', data.puesto],
    ['curp', data.curp],
    ['numero_empleado', data.numero_empleado],
    ['telefono', data.telefono]
  ];
  fieldSync.forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.value = value;
  });

  if (!CURP_REGEX.test(data.curp)) {
    alert('La CURP debe tener 18 caracteres y formato valido hasta el caracter 16.');
    return;
  }
  if (!/^\d{4}$/.test(data.numero_empleado)) {
    alert('El numero de empleado debe tener exactamente 4 digitos numericos.');
    return;
  }
  if (!data.plantel_id || Number.isNaN(data.plantel_id)) {
    alert('Selecciona un plantel valido.');
    return;
  }

  const fotoFile = document.getElementById('foto').files[0];
  const fotoBase64 = croppedPhotoDataUrl || null;
  const fotoName = croppedPhotoName || (fotoFile ? fotoFile.name : null);
  let result;
  if (currentEditingId) {
    result = await ipc.invoke('update-empleado', {
      id: currentEditingId,
      data: { ...data, foto: currentEditingFoto },
      fotoPath: fotoFile ? fotoFile.path : null,
      fotoName,
      fotoBase64
    });
  } else {
    result = await ipc.invoke('save-empleado', {
      data,
      fotoPath: fotoFile ? fotoFile.path : null,
      fotoName,
      fotoBase64
    });
  }

  if (!result.success) {
    alert(result.error || 'No se pudo guardar el registro.');
    return;
  }

  resetFormToCreateMode();
  empleadoModal.hide();
  await cargarEmpleados();
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSidebar();
  setupLogout();

  if (ipc) {
    currentUser = await ipc.invoke('get-current-user');
  }
  renderCurrentUserSidebar();
  toggleConfigMenuVisibility();
  updatePermissionsUI();

  const form = document.getElementById('empleado-form');
  const modalElement = document.getElementById('empleadoModal');
  const addButton = document.querySelector('[data-bs-target="#empleadoModal"]');
  const searchInput = document.getElementById('search-input');
  const pageSizeSelect = document.getElementById('page-size-select');

  if (!form || !modalElement) return;

  empleadoModal = bootstrap.Modal.getOrCreateInstance(modalElement);
  setupPhotoCropper();
  form.addEventListener('submit', handleSubmit);

  if (addButton) addButton.addEventListener('click', () => resetFormToCreateMode());
  if (searchInput) searchInput.addEventListener('input', () => { currentPage = 1; applySearchFilter(); });
  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', () => {
      pageSize = pageSizeSelect.value === 'all' ? 'all' : Number(pageSizeSelect.value);
      currentPage = 1;
      applySearchFilter();
    });
  }

  modalElement.addEventListener('hidden.bs.modal', () => resetFormToCreateMode());

  await cargarTurnos();
  await cargarPlanteles();
  await cargarEmpleados();
});


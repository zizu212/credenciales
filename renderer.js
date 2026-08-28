let ipc = null;
try {
  if (typeof window !== 'undefined' && window.electronAPI) {
    ipc = window.electronAPI;
  }
} catch (error) {
  ipc = null;
}

let alumnoModal = null;
let currentEditingId = null;
let currentEditingFoto = '';
let allAlumnos = [];
let allPlanteles = [];
let allTurnos = [];
let allCarreras = [];
let currentUser = null;
let filteredAlumnos = [];
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
    croppedPhotoName = `alumno_${Date.now()}.jpg`;
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
    roleEl.textContent = 'Sin sesión';
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

function updatePermissionsUI() {
  const addButton = document.querySelector('[data-bs-target="#alumnoModal"]');
  if (addButton) {
    addButton.style.display = canCreateOrEdit() ? '' : 'none';
  }
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
  const claveInput = document.getElementById('clave');
  const contactoInput = document.getElementById('contacto_emergencia');
  if (!plantelSelect || !claveInput) return;

  if (currentUser && currentUser.plantel_id) {
    plantelSelect.value = String(currentUser.plantel_id);
    plantelSelect.disabled = true;
  } else {
    plantelSelect.disabled = false;
  }

  if (currentUser && currentUser.plantel_cct) {
    claveInput.value = String(currentUser.plantel_cct);
    claveInput.readOnly = true;
  } else {
    claveInput.readOnly = false;
  }

  if (contactoInput) {
    if (currentUser && currentUser.plantel_telefono) {
      contactoInput.value = String(currentUser.plantel_telefono);
      contactoInput.readOnly = true;
    } else {
      contactoInput.readOnly = false;
    }
  }
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

function getActiveNavId() {
  const page = (document.getElementById('dashboard')?.dataset?.page || '').toLowerCase();
  if (page === 'alumnos') return 'nav-db';
  if (page === 'exportar') return 'nav-export';
  return '';
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

  const activeId = getActiveNavId();
  if (activeId) {
    const activeLink = document.getElementById(activeId);
    if (activeLink) activeLink.classList.add('active');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fotoSrc(pathValue) {
  if (!pathValue) return '';
  if (pathValue.startsWith('http://') || pathValue.startsWith('https://') || pathValue.startsWith('file://')) {
    return pathValue;
  }
  return `file://${pathValue.replace(/\\/g, '/')}`;
}

function setFormValues(alumno) {
  document.getElementById('nombres').value = alumno?.nombres || '';
  document.getElementById('apellido_paterno').value = alumno?.apellido_paterno || '';
  document.getElementById('apellido_materno').value = alumno?.apellido_materno || '';
  const carreraSelect = document.getElementById('carrera');
  const carreraIdValue = alumno?.carrera_id ? String(alumno.carrera_id) : '';
  const carreraNombreValue = String(alumno?.carrera_nombre || alumno?.carrera || '').trim();
  if (carreraSelect) {
    if (carreraIdValue) {
      carreraSelect.value = carreraIdValue;
    } else if (carreraNombreValue) {
      const match = allCarreras.find((item) => String(item.nombre_carrera || '').trim().toLowerCase() === carreraNombreValue.toLowerCase());
      if (match) {
        carreraSelect.value = String(match.id);
      } else {
      const legacyValue = `legacy:${carreraNombreValue}`;
      if (!Array.from(carreraSelect.options).some((opt) => opt.value === legacyValue)) {
        carreraSelect.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(legacyValue)}">${escapeHtml(carreraNombreValue)}</option>`);
      }
      carreraSelect.value = legacyValue;
      }
    } else {
      carreraSelect.value = '';
    }
  }
  document.getElementById('turno').value = alumno?.turno || '';
  document.getElementById('plantel').value = alumno?.plantel_id ? String(alumno.plantel_id) : '';
  document.getElementById('curp').value = alumno?.curp || '';
  document.getElementById('no_control').value = alumno?.no_control || '';
  document.getElementById('clave').value = alumno?.clave || '';
  document.getElementById('contacto_emergencia').value = alumno?.contacto_emergencia || '';
}

function renderCarrerasOptions(carreras) {
  const select = document.getElementById('carrera');
  if (!select) return;

  let options = '<option value="">Selecciona una carrera</option>';
  carreras.forEach((carrera) => {
    const label = String(carrera.nombre_carrera || '').trim();
    if (!label) return;
    options += `<option value="${escapeHtml(carrera.id)}">${escapeHtml(label)}</option>`;
  });
  select.innerHTML = options;
}

function getCarreraNombreFromSelection() {
  const select = document.getElementById('carrera');
  if (!select) return '';
  const selectedValue = String(select.value || '').trim();
  if (!selectedValue) return '';

  const found = allCarreras.find((item) => String(item.id) === selectedValue);
  if (found && found.nombre_carrera) {
    return toUpperEs(found.nombre_carrera);
  }

  const selectedOption = select.options[select.selectedIndex];
  return selectedOption ? toUpperEs(selectedOption.text || '') : '';
}

function getCarreraIdFromSelection() {
  const select = document.getElementById('carrera');
  if (!select) return null;
  const selectedValue = String(select.value || '').trim();
  if (!selectedValue || selectedValue.startsWith('legacy:')) {
    return null;
  }
  const asNumber = Number(selectedValue);
  return Number.isNaN(asNumber) ? null : asNumber;
}

async function cargarCarreras() {
  if (!ipc) return;
  const response = await ipc.invoke('get-carreras');
  if (!response || !response.success) {
    allCarreras = [];
    renderCarrerasOptions([]);
    return;
  }
  allCarreras = Array.isArray(response.data) ? response.data : [];
  renderCarrerasOptions(allCarreras);
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

async function cargarTurnos() {
  if (!ipc) return;
  const response = await ipc.invoke('get-turnos');
  if (!response || !response.success) {
    allTurnos = [];
    renderTurnosOptions([]);
    return;
  }
  allTurnos = Array.isArray(response.data) ? response.data : [];
  renderTurnosOptions(allTurnos);
}

function getFormData() {
  const plantelValue = document.getElementById('plantel').value.trim();
  const userPlantel = currentUser && currentUser.plantel_id ? Number(currentUser.plantel_id) : null;
  const userCct = currentUser && currentUser.plantel_cct ? String(currentUser.plantel_cct).trim() : '';
  const userPlantelPhone = currentUser && currentUser.plantel_telefono ? String(currentUser.plantel_telefono).trim() : '';
  return {
    nombres: toUpperEs(document.getElementById('nombres').value),
    apellido_paterno: toUpperEs(document.getElementById('apellido_paterno').value),
    apellido_materno: toUpperEs(document.getElementById('apellido_materno').value),
    carrera_id: getCarreraIdFromSelection(),
    carrera: toUpperEs(getCarreraNombreFromSelection()),
    turno: toUpperEs(document.getElementById('turno').value),
    plantel_id: userPlantel || (plantelValue ? Number(plantelValue) : null),
    curp: toUpperEs(document.getElementById('curp').value),
    no_control: toUpperEs(document.getElementById('no_control').value),
    clave: toUpperEs(userCct || document.getElementById('clave').value),
    no_foto: '',
    contacto_emergencia: toUpperEs(userPlantelPhone || document.getElementById('contacto_emergencia').value)
  };
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

async function cargarPlanteles() {
  if (!ipc) return;
  const response = await ipc.invoke('get-planteles');
  if (!response || !response.success) {
    allPlanteles = [];
    renderPlantelesOptions([]);
    return;
  }
  allPlanteles = Array.isArray(response.data) ? response.data : [];
  renderPlantelesOptions(allPlanteles);
  applyLoggedUserDefaults();
}

function resetFormToCreateMode() {
  currentEditingId = null;
  currentEditingFoto = '';
  croppedPhotoDataUrl = '';
  croppedPhotoName = '';
  destroyCropper();
  const form = document.getElementById('alumno-form');
  if (form) form.reset();
  setFormValues(null);
  applyLoggedUserDefaults();
  setPhotoCropStatus('Al seleccionar una imagen, se abrira el recorte de credencial.');
  const modalTitle = document.getElementById('alumnoModalLabel');
  const header = modalTitle ? modalTitle.closest('.modal-header') : null;
  if (header) { header.classList.remove('bg-warning', 'text-dark'); header.classList.add('bg-success', 'text-white'); modalTitle.innerHTML = '<i class="bi bi-person-plus me-2"></i>Agregar Alumno'; }
  const btnClose = header ? header.querySelector('.btn-close') : null;
  if (btnClose) { btnClose.classList.add('btn-close-white'); }
  if (modalTitle) modalTitle.textContent = 'Agregar Alumno';
}

function renderTable(alumnos) {
  const tbody = document.getElementById('alumnos-table-body');
  const emptyState = document.getElementById('empty-state');
  if (!tbody) return;

  if (!Array.isArray(alumnos) || alumnos.length === 0) {
    tbody.innerHTML = `
  <tr><td colspan="13" class="text-center text-muted">Sin coincidencias.</td></tr>';
    if (emptyState) emptyState.classList.remove('d-none');
    return;
  }

  if (emptyState) emptyState.classList.add('d-none');

  let html = '';

  alumnos.forEach((alumno) => {
    const image = alumno.foto
      ? `<img src="${escapeHtml(fotoSrc(alumno.foto))}" style="width:42px;height:42px;object-fit:cover;" class="rounded border" alt="Foto">`
      : '';

    html += `
      <tr>
        <td>${escapeHtml(alumno.id)}</td>
        <td>${image}</td>
        <td>${escapeHtml(alumno.nombres)}</td>
        <td>${escapeHtml(alumno.apellido_paterno)}</td>
        <td>${escapeHtml(alumno.apellido_materno)}</td>
        <td>${escapeHtml(alumno.carrera_nombre || alumno.carrera)}</td>
        <td>${escapeHtml(alumno.turno)}</td>
        <td class="d-none">${escapeHtml(alumno.plantel_nombre || alumno.plantel_id)}</td>
        <td>${escapeHtml(alumno.curp)}</td>
        <td>${escapeHtml(alumno.no_control)}</td>
        <td class="d-none">${escapeHtml(alumno.clave)}</td>
        <td class="d-none">${escapeHtml(alumno.contacto_emergencia)}</td>
        <td>
          ${canCreateOrEdit() ? `<button class="btn btn-warning btn-sm me-1 editar-alumno" data-id="${escapeHtml(alumno.id)}" title="Editar"><i class="bi bi-pencil"></i></button>` : ''}
          ${canDelete() ? `<button class="btn btn-danger btn-sm eliminar-alumno" data-id="${escapeHtml(alumno.id)}" title="Eliminar"><i class="bi bi-trash"></i></button>` : ''}
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;

  tbody.querySelectorAll('.editar-alumno').forEach((btn) => {
    btn.addEventListener('click', () => openEdit(btn.dataset.id));
  });

  tbody.querySelectorAll('.eliminar-alumno').forEach((btn) => {
    btn.addEventListener('click', () => deleteAlumno(btn.dataset.id));
  });
}

function getPagedRows(rows) {
  if (pageSize === 'all') {
    return rows;
  }
  const numericPageSize = Number(pageSize);
  const start = (currentPage - 1) * numericPageSize;
  const end = start + numericPageSize;
  return rows.slice(start, end);
}

function renderPagination() {
  const nav = document.getElementById('page-nav');
  if (!nav) return;

  if (!filteredAlumnos.length || pageSize === 'all') {
    nav.innerHTML = `<span class="small text-muted">${filteredAlumnos.length} registros</span>`;
    return;
  }

  const numericPageSize = Number(pageSize);
  const totalPages = Math.max(1, Math.ceil(filteredAlumnos.length / numericPageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  nav.innerHTML = `
    <button class="btn btn-secondary btn-sm" id="page-prev" ${currentPage === 1 ? 'disabled' : ''}>Anterior</button>
    <span class="small text-muted">Pagina ${currentPage} de ${totalPages}</span>
    <button class="btn btn-secondary btn-sm" id="page-next" ${currentPage === totalPages ? 'disabled' : ''}>Siguiente</button>
  `;

  const prev = document.getElementById('page-prev');
  const next = document.getElementById('page-next');
  if (prev) {
    prev.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage -= 1;
        renderTable(getPagedRows(filteredAlumnos));
        renderPagination();
      }
    });
  }
  if (next) {
    next.addEventListener('click', () => {
      if (currentPage < totalPages) {
        currentPage += 1;
        renderTable(getPagedRows(filteredAlumnos));
        renderPagination();
      }
    });
  }
}

function alumnoMatchesQuery(alumno, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const haystack = [
    alumno.id,
    alumno.nombres,
    alumno.apellido_paterno,
    alumno.apellido_materno,
    alumno.carrera_nombre,
    alumno.carrera,
    alumno.turno,
    alumno.plantel_nombre,
    alumno.plantel_id,
    alumno.curp,
    alumno.no_control,
    alumno.clave,
    alumno.contacto_emergencia
  ]
    .map((v) => String(v ?? '').toLowerCase())
    .join(' ');
  return haystack.includes(q);
}

function applySearchFilter() {
  const searchInput = document.getElementById('search-input');
  const query = searchInput ? searchInput.value.trim() : '';
  filteredAlumnos = allAlumnos.filter((alumno) => alumnoMatchesQuery(alumno, query));
  const paged = getPagedRows(filteredAlumnos);
  renderTable(paged);
  renderPagination();
}

async function cargarAlumnos() {
  if (!ipc) {
    const tbody = document.getElementById('alumnos-table-body');
    if (tbody) {
      tbody.innerHTML = `
  <tr><td colspan="13" class="text-danger text-center">No hay comunicacion IPC con Electron.</td></tr>';
    }
    return;
  }

  const response = await ipc.invoke('get-alumnos');
  if (Array.isArray(response)) {
    allAlumnos = response;
    applySearchFilter();
    return;
  }

  if (!response || !response.success) {
    allAlumnos = [];
    renderTable([]);
    const tbody = document.getElementById('alumnos-table-body');
    if (tbody) {
      const errorText = response && response.error ? escapeHtml(response.error) : 'No se pudo consultar la base de datos.';
      tbody.innerHTML = `<tr><td colspan="13" class="text-danger text-center">Error al cargar datos: ${errorText}</td></tr>`;
    }
    return;
  }

  allAlumnos = Array.isArray(response.data) ? response.data : [];
  applySearchFilter();
}

async function openEdit(id) {
  if (!canCreateOrEdit()) {
    alert('No tienes permisos para editar registros.');
    return;
  }
  const response = await ipc.invoke('get-alumnos');
  const alumnos = Array.isArray(response) ? response : (response && response.success ? response.data : []);
  const alumno = alumnos.find((item) => String(item.id) === String(id));
  if (!alumno) {
    alert('No se encontro el alumno para editar.');
    return;
  }

  currentEditingId = alumno.id;
  currentEditingFoto = alumno.foto || '';
  croppedPhotoDataUrl = '';
  croppedPhotoName = '';
  setFormValues(alumno);
  setPhotoCropStatus('Si seleccionas nueva foto, podras recortarla antes de guardar.');
  const modalTitle = document.getElementById('alumnoModalLabel');
  modalTitle.innerHTML = `<i class="bi bi-pencil-square me-2"></i>Editar Alumno #${alumno.id}`;
  const header = modalTitle.closest('.modal-header');
  if (header) { header.classList.remove('bg-primary', 'text-white'); header.classList.add('bg-warning', 'text-dark'); }
  const btnClose = header ? header.querySelector('.btn-close') : null;
  if (btnClose) { btnClose.classList.remove('btn-close-white'); }
  const fotoInput = document.getElementById('foto');
  if (fotoInput) fotoInput.value = '';
  alumnoModal.show();
}

async function deleteAlumno(id) {
  if (!canDelete()) {
    alert('No tienes permisos para eliminar registros.');
    return;
  }
  const ok = await window.bootstrapConfirm('Deseas eliminar este registro?');
  if (!ok) return;

  const result = await ipc.invoke('delete-alumno', { id: Number(id) });
  if (!result.success) {
    alert(result.error || 'No se pudo eliminar el registro.');
    return;
  }

  await cargarAlumnos();
}

async function handleSubmit(event) {
  event.preventDefault();

  if (!canCreateOrEdit()) {
    alert('No tienes permisos para guardar registros.');
    return;
  }

  const data = getFormData();
  const fieldSync = [
    ['nombres', data.nombres],
    ['apellido_paterno', data.apellido_paterno],
    ['apellido_materno', data.apellido_materno],
    ['curp', data.curp],
    ['no_control', data.no_control],
    ['clave', data.clave],
    ['contacto_emergencia', data.contacto_emergencia]
  ];
  fieldSync.forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.value = value;
  });

  if (!CURP_REGEX.test(data.curp)) {
    alert('La CURP debe tener 18 caracteres y formato valido hasta el caracter 16.');
    return;
  }
  if (!/^\d{14}$/.test(data.no_control)) {
    alert('La matricula (No de control) debe tener exactamente 14 digitos numericos.');
    return;
  }
  if (!data.carrera_id || Number.isNaN(data.carrera_id)) {
    alert('Selecciona una carrera valida.');
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
    result = await ipc.invoke('update-alumno', {
      id: currentEditingId,
      data: { ...data, foto: currentEditingFoto },
      fotoPath: fotoFile ? fotoFile.path : null,
      fotoName,
      fotoBase64
    });
  } else {
    result = await ipc.invoke('save-alumno', {
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
  alumnoModal.hide();
  await cargarAlumnos();
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
  applyLoggedUserDefaults();

  const form = document.getElementById('alumno-form');
  const modalElement = document.getElementById('alumnoModal');
  const addButton = document.querySelector('[data-bs-target="#alumnoModal"]');
  const searchInput = document.getElementById('search-input');
  const pageSizeSelect = document.getElementById('page-size-select');

  if (!form || !modalElement) return;

  alumnoModal = bootstrap.Modal.getOrCreateInstance(modalElement);
  setupPhotoCropper();

  form.addEventListener('submit', handleSubmit);

  if (addButton) {
    addButton.addEventListener('click', () => {
      resetFormToCreateMode();
    });
  }

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      currentPage = 1;
      applySearchFilter();
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.addEventListener('change', () => {
      pageSize = pageSizeSelect.value === 'all' ? 'all' : Number(pageSizeSelect.value);
      currentPage = 1;
      applySearchFilter();
    });
  }

  modalElement.addEventListener('hidden.bs.modal', () => {
    resetFormToCreateMode();
  });

  window.cargarAlumnos = cargarAlumnos;
  cargarCarreras();
  cargarTurnos();
  cargarPlanteles();
  cargarAlumnos();
});


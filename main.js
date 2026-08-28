const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');
const backend = require('./backend');
let currentUser = null;
let mainWindow = null;

function normalizeTextEs(value) {
  return String(value || '').trim().normalize('NFC').toLocaleUpperCase('es-MX');
}

function normalizeRecordTextFields(record, fields) {
  const normalized = { ...(record || {}) };
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      normalized[field] = normalizeTextEs(normalized[field]);
    }
  });
  return normalized;
}

function getAuditActor() {
  if (!currentUser) return 'SISTEMA';
  return normalizeTextEs(currentUser.nombre_completo || currentUser.username || 'SISTEMA');
}

function sanitizeFileName(name) {
  return String(name || 'archivo').replace(/[\\/:*?"<>|]/g, '_');
}

function resolvePhotoPath(rawPath) {
  if (!rawPath) return '';
  let photoPath = String(rawPath).trim();
  if (!photoPath) return '';

  if (photoPath.startsWith('file://')) {
    photoPath = decodeURIComponent(photoPath.replace('file://', ''));
  }

  if (fs.existsSync(photoPath)) {
    return photoPath;
  }

  if (!path.isAbsolute(photoPath)) {
    const userDataPath = app.getPath('userData');
    const userDataCandidate = path.join(userDataPath, photoPath);
    if (fs.existsSync(userDataCandidate)) {
      return userDataCandidate;
    }

    const relativePath = path.join(__dirname, photoPath);
    if (fs.existsSync(relativePath)) {
      return relativePath;
    }
  }

  return '';
}

function canCreateOrEdit(role) {
  if (isMaintenanceUser()) return true;
  return role === 'admin' || role === 'capturista';
}

function canDelete(role) {
  if (isMaintenanceUser()) return true;
  return role === 'admin';
}

function isAdminUser() {
  return currentUser && currentUser.rol === 'admin';
}

function isMaintenanceUser() {
  if (!currentUser) return false;
  return normalizeTextEs(currentUser.username || '') === 'MANTENIMIENTO';
}

function canManagePlantelesConfig() {
  return isMaintenanceUser();
}

function hasMaintenanceOnlyConfigAccess() {
  return isMaintenanceUser();
}

function hasSuperCrudAccess() {
  return isAdminUser() || isMaintenanceUser();
}

function sumTableCounts(tables) {
  if (!tables || typeof tables !== 'object') return 0;
  return Object.values(tables).reduce((total, value) => {
    const n = Number(value);
    if (Number.isNaN(n) || !Number.isFinite(n) || n < 0) return total;
    return total + n;
  }, 0);
}

function collectBackupSourceFolders() {
  const userDataPath = app.getPath('userData');
  const folders = [
    path.join(userDataPath, 'fotos'),
    path.join(userDataPath, 'fotos_empleados'),
    path.join(__dirname, 'fotos'),
    path.join(__dirname, 'fotos_empleados')
  ];

  // Evita rutas duplicadas y solo conserva carpetas existentes.
  const unique = [];
  folders.forEach((folder) => {
    if (!folder) return;
    if (unique.includes(folder)) return;
    if (!fs.existsSync(folder)) return;
    try {
      if (!fs.statSync(folder).isDirectory()) return;
      unique.push(folder);
    } catch (error) {
      // Ignora rutas no legibles.
    }
  });

  return unique;
}

function addDirectoryToZip(zip, sourceDir, targetDir, counters) {
  if (!fs.existsSync(sourceDir)) return;
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });

  entries.forEach((entry) => {
    const sourcePath = path.join(sourceDir, entry.name);
    const zipPath = `${targetDir}/${entry.name}`;

    if (entry.isDirectory()) {
      addDirectoryToZip(zip, sourcePath, zipPath, counters);
      return;
    }

    if (!entry.isFile()) return;
    const fileBuffer = fs.readFileSync(sourcePath);
    zip.addFile(zipPath.replace(/\\/g, '/'), fileBuffer);
    counters.files += 1;
  });
}

function getRowsForBackup(fetcher) {
  return new Promise((resolve, reject) => {
    fetcher((err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(Array.isArray(rows) ? rows : []);
    });
  });
}

function toCellText(value) {
  if (value === null || typeof value === 'undefined') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

function buildWorkbookBuffer(sheetName, columns, rows) {
  const header = columns.map((column) => column.label);
  const body = (rows || []).map((row) => columns.map((column) => toCellText(row?.[column.key])));
  const worksheet = XLSX.utils.aoa_to_sheet([header, ...body]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

function backendCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
  });
}

function normalizeHeaderKey(value) {
  return String(value || '')
    .trim()
    .replace(/\uFEFF/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function splitDelimitedLine(line, delimiter) {
  const parts = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      parts.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  parts.push(current.trim());
  return parts;
}

function buildRowsFromMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length < 2) {
    throw new Error('El archivo debe incluir encabezados y al menos una fila de datos.');
  }

  let normalizedMatrix = matrix;
  const firstRowValue = String(normalizedMatrix?.[0]?.[0] || '').trim();
  if (/^sep\s*=/i.test(firstRowValue)) {
    normalizedMatrix = normalizedMatrix.slice(1);
  }

  if (!normalizedMatrix.length) {
    throw new Error('El archivo debe incluir encabezados y al menos una fila de datos.');
  }

  const firstCell = String(normalizedMatrix?.[0]?.[0] || '');
  const commaCount = (firstCell.match(/,/g) || []).length;
  const semicolonCount = (firstCell.match(/;/g) || []).length;
  if (normalizedMatrix?.[0]?.length === 1 && semicolonCount > 0) {
    normalizedMatrix = normalizedMatrix.map((row) => splitDelimitedLine(String(Array.isArray(row) ? row[0] : row || ''), ';'));
  } else if (normalizedMatrix?.[0]?.length === 1 && commaCount > 0) {
    normalizedMatrix = normalizedMatrix.map((row) => splitDelimitedLine(String(Array.isArray(row) ? row[0] : row || ''), ','));
  }

  const headerRow = Array.isArray(normalizedMatrix[0]) ? normalizedMatrix[0] : [];
  const headers = headerRow.map((item) => normalizeHeaderKey(item));
  const hasValidHeaders = headers.some((item) => !!item);
  if (!hasValidHeaders) {
    throw new Error('No se detectaron encabezados validos en el archivo.');
  }

  const rows = [];
  for (let index = 1; index < normalizedMatrix.length; index += 1) {
    const rowValues = Array.isArray(normalizedMatrix[index]) ? normalizedMatrix[index] : [];
    const row = { __line: index + 1 };
    let hasContent = false;

    headers.forEach((key, colIndex) => {
      if (!key) return;
      const value = String(rowValues[colIndex] || '').trim();
      if (value) hasContent = true;
      row[key] = value;
    });

    if (hasContent) rows.push(row);
  }

  if (!rows.length) {
    throw new Error('No se encontraron filas con datos para importar.');
  }

  return rows;
}

function parseCsvRows(filePath) {
  const source = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const rawLines = source
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter((line) => line.length > 0);

  if (!rawLines.length) {
    throw new Error('El archivo CSV no contiene informacion.');
  }

  let lines = rawLines;
  if (/^sep\s*=/i.test(lines[0])) {
    lines = lines.slice(1);
  }

  if (!lines.length) {
    throw new Error('El archivo CSV debe incluir encabezados y al menos una fila de datos.');
  }

  return buildRowsFromMatrix(lines.map((line) => splitDelimitedLine(line, (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',')));
}

function parseSpreadsheetRows(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.xlsx' || ext === '.xls' || ext === '.xlsm') {
    const source = fs.readFileSync(filePath);
    const workbook = XLSX.read(source, { type: 'buffer', raw: false, codepage: 65001 });
    const sheetName = workbook.SheetNames && workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('El archivo no contiene informacion.');
    }
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: false });
    return buildRowsFromMatrix(matrix);
  }

  return parseCsvRows(filePath);
}

function csvValue(row, aliases) {
  const list = Array.isArray(aliases) ? aliases : [aliases];
  for (const alias of list) {
    const key = normalizeHeaderKey(alias);
    const raw = row ? row[key] : '';
    const value = String(raw || '').trim();
    if (value) return value;
  }
  return '';
}

function findPlantelForImport(row, planteles, userPlantelId) {
  const entries = Array.isArray(planteles) ? planteles : [];
  if (userPlantelId) {
    return entries.find((item) => Number(item.id) === Number(userPlantelId)) || null;
  }

  const rawId = csvValue(row, ['PLANTEL_ID', 'ID_PLANTEL']);
  if (rawId) {
    const id = Number(rawId);
    if (!Number.isNaN(id)) {
      const byId = entries.find((item) => Number(item.id) === id);
      if (byId) return byId;
    }
  }

  const rawCct = normalizeTextEs(csvValue(row, ['CCT', 'CLAVE_CCT', 'PLANTEL_CCT', 'CLAVE']));
  if (rawCct) {
    const byCct = entries.find((item) => normalizeTextEs(item.cct) === rawCct);
    if (byCct) return byCct;
  }

  const rawName = normalizeTextEs(csvValue(row, ['PLANTEL', 'NOMBRE_PLANTEL']));
  if (rawName) {
    const byName = entries.find((item) => normalizeTextEs(item.nombre) === rawName);
    if (byName) return byName;
  }

  return null;
}

function resolveTurno(row, turnos) {
  const rawTurno = normalizeTextEs(csvValue(row, ['TURNO']));
  if (!rawTurno) return null;
  const entries = Array.isArray(turnos) ? turnos : [];
  return entries.find((item) => normalizeTextEs(item.nombre_turno) === rawTurno) || null;
}

function resolveCarrera(row, carreras) {
  const entries = Array.isArray(carreras) ? carreras : [];
  const rawId = csvValue(row, ['CARRERA_ID', 'ID_CARRERA']);
  if (rawId) {
    const id = Number(rawId);
    if (!Number.isNaN(id)) {
      const byId = entries.find((item) => Number(item.id) === id);
      if (byId) return byId;
    }
  }

  const rawName = normalizeTextEs(csvValue(row, ['CARRERA', 'NOMBRE_CARRERA']));
  if (!rawName) return null;
  return entries.find((item) => normalizeTextEs(item.nombre_carrera) === rawName) || null;
}

async function importAlumnosCsvFile(filePath) {
  const rows = parseSpreadsheetRows(filePath);
  const [turnos, carreras, planteles] = await Promise.all([
    backendCall(backend.getTurnos.bind(backend)),
    backendCall(backend.getCarreras.bind(backend)),
    backendCall(backend.getPlanteles.bind(backend))
  ]);

  const resolvedPlantelId = currentUser && currentUser.plantel_id ? Number(currentUser.plantel_id) : null;
  if (!resolvedPlantelId || Number.isNaN(resolvedPlantelId)) {
    throw new Error('El usuario actual no tiene plantel asignado. No se puede importar alumnos.');
  }

  const userPlantel = (Array.isArray(planteles) ? planteles : []).find((item) => Number(item.id) === resolvedPlantelId);
  if (!userPlantel) {
    throw new Error('No se encontro el plantel seleccionado en el catalogo.');
  }
  const actor = getAuditActor();
  const errors = [];
  let imported = 0;

  for (const row of rows) {
    try {
      const nombres = csvValue(row, ['NOMBRES', 'NOMBRE']);
      const apellidoPaterno = csvValue(row, ['APELLIDO_PATERNO', 'PATERNO']);
      const apellidoMaterno = csvValue(row, ['APELLIDO_MATERNO', 'MATERNO']);
      const curp = csvValue(row, ['CURP']);
      const noControl = csvValue(row, ['NO_CONTROL', 'NUMERO_CONTROL', 'MATRICULA']);

      if (!nombres || !apellidoPaterno || !apellidoMaterno || !curp || !noControl) {
        throw new Error('Faltan campos obligatorios: NOMBRES, APELLIDO_PATERNO, APELLIDO_MATERNO, CURP, NO_CONTROL.');
      }

      const turnoItem = resolveTurno(row, turnos);
      if (!turnoItem) {
        throw new Error('No se encontro el TURNO en el catalogo.');
      }

      const carreraItem = resolveCarrera(row, carreras);
      if (!carreraItem) {
        throw new Error('No se encontro la CARRERA en el catalogo.');
      }

      const data = normalizeRecordTextFields({
        nombres,
        apellido_paterno: apellidoPaterno,
        apellido_materno: apellidoMaterno,
        carrera_id: Number(carreraItem.id),
        carrera: carreraItem.nombre_carrera,
        turno: turnoItem.nombre_turno,
        plantel_id: Number(userPlantel.id),
        curp,
        no_control: noControl,
        clave: userPlantel.cct || '',
        no_foto: '',
        contacto_emergencia: userPlantel.telefono || '',
        created_by: actor,
        updated_by: actor
      }, [
        'nombres',
        'apellido_paterno',
        'apellido_materno',
        'carrera',
        'turno',
        'curp',
        'no_control',
        'clave',
        'contacto_emergencia',
        'created_by',
        'updated_by'
      ]);

      await backendCall(backend.saveAlumno.bind(backend), data, null);
      imported += 1;
    } catch (error) {
      errors.push(`Linea ${row.__line}: ${error.message}`);
    }
  }

  return {
    total: rows.length,
    imported,
    failed: errors.length,
    errors
  };
}

async function importEmpleadosCsvFile(filePath) {
  const rows = parseSpreadsheetRows(filePath);
  const [turnos, planteles] = await Promise.all([
    backendCall(backend.getTurnos.bind(backend)),
    backendCall(backend.getPlanteles.bind(backend))
  ]);

  const resolvedPlantelId = currentUser && currentUser.plantel_id ? Number(currentUser.plantel_id) : null;
  if (!resolvedPlantelId || Number.isNaN(resolvedPlantelId)) {
    throw new Error('El usuario actual no tiene plantel asignado. No se puede importar personal.');
  }

  const userPlantel = (Array.isArray(planteles) ? planteles : []).find((item) => Number(item.id) === resolvedPlantelId);
  if (!userPlantel) {
    throw new Error('No se encontro el plantel seleccionado en el catalogo.');
  }
  const actor = getAuditActor();
  const errors = [];
  let imported = 0;

  for (const row of rows) {
    try {
      const nombres = csvValue(row, ['NOMBRES', 'NOMBRE']);
      const apellidoPaterno = csvValue(row, ['APELLIDO_PATERNO', 'PATERNO']);
      const apellidoMaterno = csvValue(row, ['APELLIDO_MATERNO', 'MATERNO']);
      const puesto = csvValue(row, ['PUESTO']);
      const curp = csvValue(row, ['CURP']);
      const numeroEmpleado = csvValue(row, ['NUMERO_EMPLEADO', 'NO_EMPLEADO', 'NUM_EMPLEADO']);

      if (!nombres || !apellidoPaterno || !apellidoMaterno || !puesto || !curp || !numeroEmpleado) {
        throw new Error('Faltan campos obligatorios: NOMBRES, APELLIDO_PATERNO, APELLIDO_MATERNO, PUESTO, CURP, NUMERO_EMPLEADO.');
      }

      const turnoItem = resolveTurno(row, turnos);
      if (!turnoItem) {
        throw new Error('No se encontro el TURNO en el catalogo.');
      }

      const data = normalizeRecordTextFields({
        nombres,
        apellido_paterno: apellidoPaterno,
        apellido_materno: apellidoMaterno,
        puesto,
        turno: turnoItem.nombre_turno,
        plantel_id: Number(userPlantel.id),
        curp,
        numero_empleado: numeroEmpleado,
        telefono: userPlantel.telefono || '',
        created_by: actor,
        updated_by: actor
      }, [
        'nombres',
        'apellido_paterno',
        'apellido_materno',
        'puesto',
        'turno',
        'curp',
        'numero_empleado',
        'telefono',
        'created_by',
        'updated_by'
      ]);

      await backendCall(backend.saveEmpleado.bind(backend), data, null);
      imported += 1;
    } catch (error) {
      errors.push(`Linea ${row.__line}: ${error.message}`);
    }
  }

  return {
    total: rows.length,
    imported,
    failed: errors.length,
    errors
  };
}

function csvTemplateBuffer(lines) {
  return Buffer.from(`\uFEFF${String(lines || '')}`, 'utf8');
}

function createWindow(startFile = 'login.html') {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#ffffff'
    },
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true
    }
  });
  mainWindow.loadFile(startFile);
  return mainWindow;
}

app.whenReady().then(() => {
  createWindow('login.html');

  const loadAuthEntry = (win) => {
    if (!win) return;
    backend.countAdminUsers((countErr, totalAdmins) => {
      if (!win) return;

      // If admin count cannot be read, prioritize recovery flow to avoid lockout.
      if (countErr) {
        win.loadFile('nuevo_usuario.html');
        return;
      }

      const hasAdmin = Number(totalAdmins || 0) > 0;
      win.loadFile(hasAdmin ? 'login.html' : 'nuevo_usuario.html');
    });
  };

  const openLoginOrSetup = () => {
    backend.ensureDatabaseReady(null, (dbErr) => {
      if (!mainWindow) return;
      if (dbErr) {
        dialog.showErrorBox('Error de base de datos', `No se pudo inicializar SQLite: ${dbErr.message}`);
        mainWindow.loadFile('login.html');
      } else {
        loadAuthEntry(mainWindow);
      }
    });
  };

  openLoginOrSetup();

  ipcMain.handle('verify-user', async (event, { username, password }) => {
    return new Promise((resolve) => {
      backend.verifyUser(username, password, (err, user) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }
        if (!user) {
          resolve({ success: false, error: 'Usuario o contraseña incorrectos.' });
          return;
        }
        resolve({ success: true, user });
      });
    });
  });

  ipcMain.handle('create-user', async (event, userData) => {
    return new Promise((resolve) => {
      const allowedRoles = ['admin', 'capturista'];
      if (!userData || !userData.username || !userData.password || !userData.nombre_completo) {
        resolve({ success: false, error: 'Faltan datos obligatorios del usuario.' });
        return;
      }
      backend.countAdminUsers((countErr, totalAdmins) => {
        if (countErr) {
          resolve({ success: false, error: countErr.message });
          return;
        }

        const isBootstrapMode = Number(totalAdmins || 0) === 0;
        if (isBootstrapMode && userData.rol !== 'admin') {
          resolve({ success: false, error: 'El primer usuario debe ser administrador.' });
          return;
        }

        if (!isBootstrapMode && !allowedRoles.includes(userData.rol)) {
          resolve({ success: false, error: 'Rol invalido.' });
          return;
        }

        if (!isBootstrapMode && !hasSuperCrudAccess()) {
          resolve({ success: false, error: 'Solo administradores o superadmin pueden crear usuarios.' });
          return;
        }

        backend.createUser(userData, (err, success) => {
          if (err) {
            resolve({ success: false, error: err.message });
          } else {
            resolve({ success });
          }
        });
      });
    });
  });

  ipcMain.handle('has-users', async () => {
    return new Promise((resolve) => {
      backend.countAdminUsers((err, totalAdmins) => {
        if (err) {
          resolve({ success: false, hasUsers: false, hasAdmin: false, error: err.message });
          return;
        }
        const hasAdmin = Number(totalAdmins || 0) > 0;
        resolve({ success: true, hasUsers: hasAdmin, hasAdmin });
      });
    });
  });

  ipcMain.handle('get-current-user', async () => {
    return currentUser;
  });

  ipcMain.handle('get-alumnos', async () => {
    return new Promise((resolve) => {
      backend.getAlumnos((err, results) => {
        if (err) {
          console.error('Error en get-alumnos:', err.message);
          resolve({ success: false, data: [], error: err.message });
          return;
        }
        resolve({ success: true, data: results });
      });
    });
  });

  ipcMain.handle('get-registros-exportacion', async () => {
    return new Promise((resolve) => {
      backend.getExportRegistros((err, results) => {
        if (err) {
          resolve({ success: false, data: [], error: err.message });
          return;
        }
        resolve({ success: true, data: results || [] });
      });
    });
  });

  ipcMain.handle('export-selected-alumnos-zip', async (event, { ids }) => {
    return new Promise((resolve) => {
      if (!currentUser) {
        resolve({ success: false, error: 'Debes iniciar sesion para exportar.' });
        return;
      }

      const selectedIds = Array.isArray(ids)
        ? ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id))
        : [];

      if (!selectedIds.length) {
        resolve({ success: false, error: 'No hay registros seleccionados para exportar.' });
        return;
      }

      backend.getAlumnos(async (err, results) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }

        const rows = Array.isArray(results) ? results : [];
        const selectedRows = rows.filter((row) => selectedIds.includes(Number(row.id)));
        if (!selectedRows.length) {
          resolve({ success: false, error: 'No se encontraron registros para exportar.' });
          return;
        }

        const exportPhotoBase = 'C:\\IDCARDDESIGN\\DATOS\\';
        const usedPhotoNames = new Set();
        const exportPhotoNamesById = {};

        selectedRows.forEach((row) => {
          const resolvedPhotoPath = resolvePhotoPath(row.foto);
          if (!resolvedPhotoPath) {
            exportPhotoNamesById[row.id] = '';
            return;
          }

          const ext = path.extname(resolvedPhotoPath) || '.jpg';
          const originalBase = sanitizeFileName(path.basename(resolvedPhotoPath, ext) || `foto_${row.id}`);
          let candidate = `${originalBase}${ext}`;
          let attempt = 1;

          while (usedPhotoNames.has(candidate.toLowerCase())) {
            candidate = `${originalBase}_${row.id}_${attempt}${ext}`;
            attempt += 1;
          }

          usedPhotoNames.add(candidate.toLowerCase());
          exportPhotoNamesById[row.id] = candidate;
        });

        const headers = [
          'NOMBRE',
          'APELLIDO PATERNO',
          'APELLIDO MATERNO',
          'CARRERA',
          'TURNO',
          'PLANTEL',
          'CURP',
          'No. de control',
          'CCT',
          'FOTO',
          'TELEFONO'
        ];

        const rowsAoA = selectedRows.map((row) => {
          const fotoPath = exportPhotoNamesById[row.id] ? `${exportPhotoBase}${exportPhotoNamesById[row.id]}` : '';
          return [
            row.nombres || '',
            row.apellido_paterno || '',
            row.apellido_materno || '',
            row.carrera_nombre || row.carrera || '',
            row.turno || '',
            row.plantel_nombre || row.plantel_id || '',
            row.curp || '',
            row.no_control || '',
            row.clave || '',
            fotoPath,
            row.contacto_emergencia || ''
          ];
        });

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rowsAoA]);

        // Columna FOTO (J) como hipervinculo local a cada imagen exportada.
        selectedRows.forEach((row, index) => {
          const fileName = exportPhotoNamesById[row.id];
          if (!fileName) return;

          const excelRow = index + 2;
          const cellAddress = `J${excelRow}`;
          const displayPath = `${exportPhotoBase}${fileName}`;
          const targetPath = `file:///C:/IDCARDDESIGN/DATOS/${encodeURIComponent(fileName)}`;

          worksheet[cellAddress] = {
            t: 's',
            v: displayPath,
            l: { Target: targetPath, Tooltip: 'Abrir foto' }
          };
        });

        XLSX.utils.book_append_sheet(workbook, worksheet, 'ALUMNOS');
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

        const zip = new AdmZip();
        zip.addFile('ALUMNOS.xlsx', excelBuffer);

        let photosCount = 0;
        selectedRows.forEach((row) => {
          const resolvedPhotoPath = resolvePhotoPath(row.foto);
          if (!resolvedPhotoPath) return;

          try {
            const fileBuffer = fs.readFileSync(resolvedPhotoPath);
            const fileName = exportPhotoNamesById[row.id];
            if (!fileName) return;
            zip.addFile(`DATOS/${fileName}`, fileBuffer);
            photosCount += 1;
          } catch (photoErr) {
            // Si una foto falla, se omite y continua con el resto.
          }
        });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const suggestedName = `export_registros_${timestamp}.zip`;
        const saveResult = await dialog.showSaveDialog({
          title: 'Guardar ZIP de exportacion',
          defaultPath: path.join(app.getPath('downloads'), suggestedName),
          filters: [{ name: 'Archivo ZIP', extensions: ['zip'] }]
        });

        if (saveResult.canceled || !saveResult.filePath) {
          resolve({ success: false, error: 'Exportacion cancelada por el usuario.' });
          return;
        }

        try {
          zip.writeZip(saveResult.filePath);
          backend.saveExportRegistro({
            nombre_archivo: path.basename(saveResult.filePath),
            cantidad_registros: selectedRows.length,
            tipo_exportacion: 'ALUMNOS',
            usuario_creador: getAuditActor()
          }, (logErr) => {
            if (logErr) {
              resolve({ success: false, error: `ZIP generado, pero no se pudo registrar en reportes: ${logErr.message}` });
              return;
            }
            resolve({
              success: true,
              filePath: saveResult.filePath,
              recordsCount: selectedRows.length,
              photosCount
            });
          });
        } catch (zipErr) {
          resolve({ success: false, error: zipErr.message });
        }
      });
    });
  });

  ipcMain.handle('export-selected-empleados-zip', async (event, { ids }) => {
    return new Promise((resolve) => {
      if (!currentUser) {
        resolve({ success: false, error: 'Debes iniciar sesion para exportar.' });
        return;
      }

      const selectedIds = Array.isArray(ids)
        ? ids.map((id) => Number(id)).filter((id) => !Number.isNaN(id))
        : [];

      if (!selectedIds.length) {
        resolve({ success: false, error: 'No hay registros seleccionados para exportar.' });
        return;
      }

      backend.getEmpleados(async (err, results) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }

        const rows = Array.isArray(results) ? results : [];
        const selectedRows = rows.filter((row) => selectedIds.includes(Number(row.id)));
        if (!selectedRows.length) {
          resolve({ success: false, error: 'No se encontraron registros para exportar.' });
          return;
        }

        const exportPhotoBase = 'C:\\IDCARDDESIGN\\DATOS\\';
        const usedPhotoNames = new Set();
        const exportPhotoNamesById = {};

        selectedRows.forEach((row) => {
          const resolvedPhotoPath = resolvePhotoPath(row.foto);
          if (!resolvedPhotoPath) {
            exportPhotoNamesById[row.id] = '';
            return;
          }

          const ext = path.extname(resolvedPhotoPath) || '.jpg';
          const originalBase = sanitizeFileName(path.basename(resolvedPhotoPath, ext) || `foto_${row.id}`);
          let candidate = `${originalBase}${ext}`;
          let attempt = 1;

          while (usedPhotoNames.has(candidate.toLowerCase())) {
            candidate = `${originalBase}_${row.id}_${attempt}${ext}`;
            attempt += 1;
          }

          usedPhotoNames.add(candidate.toLowerCase());
          exportPhotoNamesById[row.id] = candidate;
        });

        const headers = [
          'NOMBRE',
          'APELLIDO PATERNO',
          'APELLIDO MATERNO',
          'PUESTO',
          'TURNO',
          'PLANTEL',
          'CURP',
          'No. EMPLEADO',
          'CCT',
          'FOTO',
          'TELEFONO'
        ];

        const rowsAoA = selectedRows.map((row) => {
          const fotoPath = exportPhotoNamesById[row.id] ? `${exportPhotoBase}${exportPhotoNamesById[row.id]}` : '';
          return [
            row.nombres || '',
            row.apellido_paterno || '',
            row.apellido_materno || '',
            row.puesto || '',
            row.turno || '',
            row.plantel_nombre || row.plantel_id || '',
            row.curp || '',
            row.numero_empleado || '',
            row.plantel_cct || '',
            fotoPath,
            row.telefono || ''
          ];
        });

        const workbook = XLSX.utils.book_new();
        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rowsAoA]);

        // Columna FOTO (J) como hipervinculo local a cada imagen exportada.
        selectedRows.forEach((row, index) => {
          const fileName = exportPhotoNamesById[row.id];
          if (!fileName) return;

          const excelRow = index + 2;
          const cellAddress = `J${excelRow}`;
          const displayPath = `${exportPhotoBase}${fileName}`;
          const targetPath = `file:///C:/IDCARDDESIGN/DATOS/${encodeURIComponent(fileName)}`;

          worksheet[cellAddress] = {
            t: 's',
            v: displayPath,
            l: { Target: targetPath, Tooltip: 'Abrir foto' }
          };
        });

        XLSX.utils.book_append_sheet(workbook, worksheet, 'EMPLEADOS');
        const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });

        const zip = new AdmZip();
        zip.addFile('EMPLEADOS.xlsx', excelBuffer);

        let photosCount = 0;
        selectedRows.forEach((row) => {
          const resolvedPhotoPath = resolvePhotoPath(row.foto);
          if (!resolvedPhotoPath) return;

          try {
            const fileBuffer = fs.readFileSync(resolvedPhotoPath);
            const fileName = exportPhotoNamesById[row.id];
            if (!fileName) return;
            zip.addFile(`DATOS/${fileName}`, fileBuffer);
            photosCount += 1;
          } catch (photoErr) {
            // Si una foto falla, se omite y continua con el resto.
          }
        });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const suggestedName = `export_empleados_${timestamp}.zip`;
        const saveResult = await dialog.showSaveDialog({
          title: 'Guardar ZIP de exportacion de empleados',
          defaultPath: path.join(app.getPath('downloads'), suggestedName),
          filters: [{ name: 'Archivo ZIP', extensions: ['zip'] }]
        });

        if (saveResult.canceled || !saveResult.filePath) {
          resolve({ success: false, error: 'Exportacion cancelada por el usuario.' });
          return;
        }

        try {
          zip.writeZip(saveResult.filePath);
          backend.saveExportRegistro({
            nombre_archivo: path.basename(saveResult.filePath),
            cantidad_registros: selectedRows.length,
            tipo_exportacion: 'EMPLEADOS',
            usuario_creador: getAuditActor()
          }, (logErr) => {
            if (logErr) {
              resolve({ success: false, error: `ZIP generado, pero no se pudo registrar en reportes: ${logErr.message}` });
              return;
            }
            resolve({
              success: true,
              filePath: saveResult.filePath,
              recordsCount: selectedRows.length,
              photosCount
            });
          });
        } catch (zipErr) {
          resolve({ success: false, error: zipErr.message });
        }
      });
    });
  });

  ipcMain.handle('get-planteles', async () => {
    return new Promise((resolve) => {
      backend.getPlanteles((err, results) => {
        if (err) {
          console.error('Error en get-planteles:', err.message);
          resolve({ success: false, data: [], error: err.message });
          return;
        }
        resolve({ success: true, data: results });
      });
    });
  });

  ipcMain.handle('get-turnos', async () => {
    return new Promise((resolve) => {
      backend.getTurnos((err, results) => {
        if (err) {
          console.error('Error en get-turnos:', err.message);
          resolve({ success: false, data: [], error: err.message });
          return;
        }
        resolve({ success: true, data: results });
      });
    });
  });

  ipcMain.handle('get-carreras', async () => {
    return new Promise((resolve) => {
      backend.getCarreras((err, results) => {
        if (err) {
          console.error('Error en get-carreras:', err.message);
          resolve({ success: false, data: [], error: err.message });
          return;
        }
        resolve({ success: true, data: results });
      });
    });
  });

  ipcMain.handle('save-carrera', async (event, payload) => {
    return new Promise((resolve) => {
      if (!hasSuperCrudAccess()) {
        resolve({ success: false, error: 'Solo administradores o superadmin pueden modificar configuracion.' });
        return;
      }
      const nombreCarrera = normalizeTextEs(payload?.nombre_carrera || '');
      if (!nombreCarrera) {
        resolve({ success: false, error: 'El nombre de la carrera es obligatorio.' });
        return;
      }
      backend.saveCarrera({ nombre_carrera: nombreCarrera }, (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }
        resolve({ success: true });
      });
    });
  });

  ipcMain.handle('update-carrera', async (event, payload) => {
    return new Promise((resolve) => {
      if (!hasSuperCrudAccess()) {
        resolve({ success: false, error: 'Solo administradores o superadmin pueden modificar configuracion.' });
        return;
      }
      const id = Number(payload?.id);
      const nombreCarrera = normalizeTextEs(payload?.nombre_carrera || '');
      if (!id || Number.isNaN(id) || !nombreCarrera) {
        resolve({ success: false, error: 'Datos invalidos para actualizar carrera.' });
        return;
      }
      backend.updateCarrera(id, { nombre_carrera: nombreCarrera }, (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }
        resolve({ success: true });
      });
    });
  });

  ipcMain.handle('delete-carrera', async (event, payload) => {
    return new Promise((resolve) => {
      if (!hasSuperCrudAccess()) {
        resolve({ success: false, error: 'Solo administradores o superadmin pueden modificar configuracion.' });
        return;
      }
      const id = Number(payload?.id);
      if (!id || Number.isNaN(id)) {
        resolve({ success: false, error: 'ID de carrera invalido.' });
        return;
      }
      backend.deleteCarrera(id, (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }
        resolve({ success: true });
      });
    });
  });

  ipcMain.handle('save-plantel', async (event, payload) => {
    return new Promise((resolve) => {
      if (!canManagePlantelesConfig()) {
        resolve({ success: false, error: 'Solo superadmin puede modificar planteles.' });
        return;
      }

      const nombre = normalizeTextEs(payload?.nombre || '');
      const cct = normalizeTextEs(payload?.cct || '');
      const telefono = String(payload?.telefono || '').trim();

      if (!nombre || !cct) {
        resolve({ success: false, error: 'Nombre y CCT son obligatorios.' });
        return;
      }

      backend.savePlantel({ nombre, cct, telefono }, (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }
        resolve({ success: true });
      });
    });
  });

  ipcMain.handle('update-plantel', async (event, payload) => {
    return new Promise((resolve) => {
      if (!canManagePlantelesConfig()) {
        resolve({ success: false, error: 'Solo superadmin puede modificar planteles.' });
        return;
      }

      const id = Number(payload?.id);
      const nombre = normalizeTextEs(payload?.nombre || '');
      const cct = normalizeTextEs(payload?.cct || '');
      const telefono = String(payload?.telefono || '').trim();

      if (!id || Number.isNaN(id) || !nombre || !cct) {
        resolve({ success: false, error: 'Datos invalidos para actualizar plantel.' });
        return;
      }

      backend.updatePlantel(id, { nombre, cct, telefono }, (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }
        resolve({ success: true });
      });
    });
  });

  ipcMain.handle('delete-plantel', async (event, payload) => {
    return new Promise((resolve) => {
      if (!canManagePlantelesConfig()) {
        resolve({ success: false, error: 'Solo superadmin puede modificar planteles.' });
        return;
      }
      const id = Number(payload?.id);
      if (!id || Number.isNaN(id)) {
        resolve({ success: false, error: 'ID de plantel invalido.' });
        return;
      }
      backend.deletePlantel(id, (err) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }
        resolve({ success: true });
      });
    });
  });

  ipcMain.handle('get-usuarios', async () => {
    return new Promise((resolve) => {
      if (!hasSuperCrudAccess()) {
        resolve({ success: false, data: [], error: 'Solo administradores o superadmin pueden consultar usuarios.' });
        return;
      }
      backend.getUsuarios((err, results) => {
        if (err) {
          resolve({ success: false, data: [], error: err.message });
          return;
        }
        const rows = Array.isArray(results) ? results : [];
        if (isAdminUser() && !isMaintenanceUser()) {
          const filtered = rows.filter((user) => String(user?.rol || '').trim().toLowerCase() !== 'superadmin');
          resolve({ success: true, data: filtered });
          return;
        }
        resolve({ success: true, data: rows });
      });
    });
  });

  ipcMain.handle('get-db-admin-info', async () => {
    return new Promise((resolve) => {
      if (!hasSuperCrudAccess()) {
        resolve({ success: false, error: 'Solo administradores o superadmin pueden consultar el estado de la base de datos.' });
        return;
      }

      backend.getDatabaseAdminInfo((err, info) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }
        resolve({ success: true, data: info });
      });
    });
  });

  ipcMain.handle('backup-database', async (event) => {
    return new Promise((resolve) => {
      if (!hasMaintenanceOnlyConfigAccess()) {
        resolve({ success: false, error: 'Solo superadmin puede administrar la base de datos.' });
        return;
      }

      backend.getDatabaseAdminInfo(async (infoErr, info) => {
        if (infoErr) {
          resolve({ success: false, error: infoErr.message });
          return;
        }

        const sourceFile = String(info?.filePath || '').trim();
        const sourceDir = sourceFile ? path.dirname(sourceFile) : app.getPath('documents');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const defaultName = `credenciales-respaldo-${stamp}.db`;
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;

        try {
          const saveResult = await dialog.showSaveDialog(win, {
            title: 'Guardar respaldo de base de datos',
            defaultPath: path.join(sourceDir, defaultName),
            filters: [
              { name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] },
              { name: 'Todos los archivos', extensions: ['*'] }
            ]
          });

          if (saveResult.canceled || !saveResult.filePath) {
            resolve({ success: false, canceled: true, error: 'Operacion cancelada por el usuario.' });
            return;
          }

          backend.backupDatabaseTo(saveResult.filePath, (backupErr, data) => {
            if (backupErr) {
              resolve({ success: false, error: backupErr.message });
              return;
            }

            resolve({
              success: true,
              data: {
                sourcePath: data?.sourcePath || sourceFile,
                destinationPath: saveResult.filePath
              }
            });
          });
        } catch (dialogErr) {
          resolve({ success: false, error: dialogErr.message });
        }
      });
    });
  });

  ipcMain.handle('import-database', async (event) => {
    return new Promise((resolve) => {
      if (!hasMaintenanceOnlyConfigAccess()) {
        resolve({ success: false, error: 'Solo superadmin puede administrar la base de datos.' });
        return;
      }

      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;

      dialog.showOpenDialog(win, {
        title: 'Seleccionar base de datos a importar',
        properties: ['openFile'],
        filters: [
          { name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] },
          { name: 'Todos los archivos', extensions: ['*'] }
        ]
      }).then((openResult) => {
        if (!openResult || openResult.canceled || !Array.isArray(openResult.filePaths) || !openResult.filePaths.length) {
          resolve({ success: false, canceled: true, error: 'Operacion cancelada por el usuario.' });
          return;
        }

        const selectedPath = openResult.filePaths[0];
        backend.restoreDatabaseFrom(selectedPath, (restoreErr, data) => {
          if (restoreErr) {
            resolve({ success: false, error: restoreErr.message });
            return;
          }

          backend.ensureDatabaseReady(null, (readyErr) => {
            if (readyErr) {
              resolve({ success: false, error: readyErr.message });
              return;
            }

            resolve({
              success: true,
              data: {
                sourcePath: data?.sourcePath || selectedPath,
                targetPath: data?.targetPath || '',
                backupPath: data?.backupPath || ''
              }
            });
          });
        });
      }).catch((dialogErr) => {
        resolve({ success: false, error: dialogErr.message });
      });
    });
  });

  ipcMain.handle('create-full-backup-zip', async (event) => {
    return new Promise((resolve) => {
      if (!hasSuperCrudAccess()) {
        resolve({ success: false, error: 'Solo administradores o superadmin pueden generar respaldos.' });
        return;
      }

      backend.getDatabaseAdminInfo(async (infoErr, info) => {
        if (infoErr) {
          resolve({ success: false, error: infoErr.message });
          return;
        }

        const dbFilePath = String(info?.filePath || '').trim();
        if (!dbFilePath || !fs.existsSync(dbFilePath)) {
          resolve({ success: false, error: 'No se encontro el archivo de base de datos para respaldar.' });
          return;
        }

        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const defaultName = `respaldo_total_${stamp}.zip`;
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;

        let saveResult;
        try {
          saveResult = await dialog.showSaveDialog(win, {
            title: 'Guardar respaldo completo',
            defaultPath: path.join(app.getPath('downloads'), defaultName),
            filters: [{ name: 'Archivo ZIP', extensions: ['zip'] }]
          });
        } catch (dialogErr) {
          resolve({ success: false, error: dialogErr.message });
          return;
        }

        if (!saveResult || saveResult.canceled || !saveResult.filePath) {
          resolve({ success: false, canceled: true, error: 'Operacion cancelada por el usuario.' });
          return;
        }

        try {
          const zip = new AdmZip();
          const counters = { files: 0 };

          zip.addFile(`base_datos/${path.basename(dbFilePath)}`, fs.readFileSync(dbFilePath));
          counters.files += 1;

          const sourceFolders = collectBackupSourceFolders();
          sourceFolders.forEach((folderPath) => {
            const folderName = path.basename(folderPath);
            addDirectoryToZip(zip, folderPath, `modulos/${folderName}`, counters);
          });

          const alumnosRows = await getRowsForBackup((cb) => backend.getAlumnos(cb));
          const empleadosRows = await getRowsForBackup((cb) => backend.getEmpleados(cb));

          const alumnosWorkbook = buildWorkbookBuffer('ALUMNOS', [
            { key: 'id', label: 'ID' },
            { key: 'nombres', label: 'NOMBRES' },
            { key: 'apellido_paterno', label: 'APELLIDO_PATERNO' },
            { key: 'apellido_materno', label: 'APELLIDO_MATERNO' },
            { key: 'carrera_nombre', label: 'CARRERA' },
            { key: 'turno', label: 'TURNO' },
            { key: 'plantel_nombre', label: 'PLANTEL' },
            { key: 'curp', label: 'CURP' },
            { key: 'no_control', label: 'NO_CONTROL' },
            { key: 'clave', label: 'CLAVE' },
            { key: 'no_foto', label: 'NO_FOTO' },
            { key: 'contacto_emergencia', label: 'CONTACTO_EMERGENCIA' },
            { key: 'foto', label: 'FOTO' },
            { key: 'created_at', label: 'CREATED_AT' },
            { key: 'updated_at', label: 'UPDATED_AT' },
            { key: 'created_by', label: 'CREATED_BY' },
            { key: 'updated_by', label: 'UPDATED_BY' }
          ], alumnosRows);

          const empleadosWorkbook = buildWorkbookBuffer('EMPLEADOS', [
            { key: 'id', label: 'ID' },
            { key: 'nombres', label: 'NOMBRES' },
            { key: 'apellido_paterno', label: 'APELLIDO_PATERNO' },
            { key: 'apellido_materno', label: 'APELLIDO_MATERNO' },
            { key: 'puesto', label: 'PUESTO' },
            { key: 'turno', label: 'TURNO' },
            { key: 'plantel_nombre', label: 'PLANTEL' },
            { key: 'plantel_cct', label: 'CCT' },
            { key: 'curp', label: 'CURP' },
            { key: 'numero_empleado', label: 'NUMERO_EMPLEADO' },
            { key: 'telefono', label: 'TELEFONO' },
            { key: 'foto', label: 'FOTO' },
            { key: 'created_at', label: 'CREATED_AT' },
            { key: 'updated_at', label: 'UPDATED_AT' },
            { key: 'created_by', label: 'CREATED_BY' },
            { key: 'updated_by', label: 'UPDATED_BY' }
          ], empleadosRows);

          zip.addFile('excel/ALUMNOS.xlsx', alumnosWorkbook);
          counters.files += 1;
          zip.addFile('excel/EMPLEADOS.xlsx', empleadosWorkbook);
          counters.files += 1;

          const summary = {
            createdAt: new Date().toISOString(),
            createdBy: getAuditActor(),
            databaseFile: dbFilePath,
            sourceFolders,
            excelFiles: ['excel/ALUMNOS.xlsx', 'excel/EMPLEADOS.xlsx'],
            excelRows: {
              alumnos: alumnosRows.length,
              empleados: empleadosRows.length
            },
            tableCounts: info?.tables || {},
            totalRecords: sumTableCounts(info?.tables || {}),
            totalFilesInZip: counters.files
          };

          zip.addFile('resumen_respaldo.json', Buffer.from(JSON.stringify(summary, null, 2), 'utf8'));
          counters.files += 1;

          zip.writeZip(saveResult.filePath);

          backend.saveExportRegistro({
            nombre_archivo: path.basename(saveResult.filePath),
            cantidad_registros: Number(summary.totalRecords || 0),
            tipo_exportacion: 'RESPALDO_TOTAL',
            usuario_creador: getAuditActor()
          }, (logErr) => {
            resolve({
              success: true,
              data: {
                filePath: saveResult.filePath,
                totalFiles: counters.files,
                totalRecords: Number(summary.totalRecords || 0),
                dbFile: path.basename(dbFilePath),
                excelFiles: 2,
                sourceFolders: sourceFolders.map((folder) => path.basename(folder))
              },
              warning: logErr ? `Respaldo generado, pero no se pudo registrar en reportes: ${logErr.message}` : ''
            });
          });
        } catch (zipErr) {
          resolve({ success: false, error: zipErr.message });
        }
      });
    });
  });

  ipcMain.handle('import-alumnos-csv', async (event) => {
    return new Promise((resolve) => {
      if (!hasSuperCrudAccess()) {
        resolve({ success: false, error: 'Solo administradores o superadmin pueden importar alumnos.' });
        return;
      }

      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
      dialog.showOpenDialog(win, {
        title: 'Seleccionar archivo de alumnos',
        properties: ['openFile'],
        filters: [
          { name: 'Excel', extensions: ['xlsx', 'xls', 'xlsm'] },
          { name: 'CSV UTF-8', extensions: ['csv'] },
          { name: 'Todos los archivos', extensions: ['*'] }
        ]
      }).then(async (openResult) => {
        if (!openResult || openResult.canceled || !Array.isArray(openResult.filePaths) || !openResult.filePaths.length) {
          resolve({ success: false, canceled: true, error: 'Operacion cancelada por el usuario.' });
          return;
        }

        try {
          const filePath = openResult.filePaths[0];
          const summary = await importAlumnosCsvFile(filePath);
          resolve({ success: true, data: { filePath, ...summary } });
        } catch (error) {
          resolve({ success: false, error: error.message });
        }
      }).catch((dialogErr) => {
        resolve({ success: false, error: dialogErr.message });
      });
    });
  });

  ipcMain.handle('import-empleados-csv', async (event) => {
    return new Promise((resolve) => {
      if (!hasSuperCrudAccess()) {
        resolve({ success: false, error: 'Solo administradores o superadmin pueden importar personal.' });
        return;
      }

      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
      dialog.showOpenDialog(win, {
        title: 'Seleccionar archivo de personal',
        properties: ['openFile'],
        filters: [
          { name: 'Excel', extensions: ['xlsx', 'xls', 'xlsm'] },
          { name: 'CSV UTF-8', extensions: ['csv'] },
          { name: 'Todos los archivos', extensions: ['*'] }
        ]
      }).then(async (openResult) => {
        if (!openResult || openResult.canceled || !Array.isArray(openResult.filePaths) || !openResult.filePaths.length) {
          resolve({ success: false, canceled: true, error: 'Operacion cancelada por el usuario.' });
          return;
        }

        try {
          const filePath = openResult.filePaths[0];
          const summary = await importEmpleadosCsvFile(filePath);
          resolve({ success: true, data: { filePath, ...summary } });
        } catch (error) {
          resolve({ success: false, error: error.message });
        }
      }).catch((dialogErr) => {
        resolve({ success: false, error: dialogErr.message });
      });
    });
  });

  ipcMain.handle('download-csv-templates', async (event) => {
    return new Promise((resolve) => {
      if (!hasSuperCrudAccess()) {
        resolve({ success: false, error: 'Solo administradores o superadmin pueden descargar plantillas.' });
        return;
      }

      const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
      dialog.showOpenDialog(win, {
        title: 'Selecciona una carpeta para guardar plantillas',
        properties: ['openDirectory', 'createDirectory']
      }).then((openResult) => {
        if (!openResult || openResult.canceled || !Array.isArray(openResult.filePaths) || !openResult.filePaths.length) {
          resolve({ success: false, canceled: true, error: 'Operacion cancelada por el usuario.' });
          return;
        }

        try {
          const targetDir = openResult.filePaths[0];
          const alumnosPath = path.join(targetDir, 'plantilla_alumnos_masivo.xlsx');
          const docentePath = path.join(targetDir, 'plantilla_docente.xlsx');

          const buildTemplateBuffer = (sheetName, columns, sampleRow) => {
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.aoa_to_sheet([columns, sampleRow]);

            columns.forEach((_, colIndex) => {
              const headerCell = XLSX.utils.encode_cell({ r: 0, c: colIndex });
              if (worksheet[headerCell]) {
                worksheet[headerCell].t = 's';
                worksheet[headerCell].z = '@';
              }

              const sampleCell = XLSX.utils.encode_cell({ r: 1, c: colIndex });
              if (worksheet[sampleCell]) {
                worksheet[sampleCell].t = 's';
                worksheet[sampleCell].z = '@';
              }
            });

            worksheet['!cols'] = columns.map(() => ({ wch: 24 }));
            XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
            return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
          };

          const alumnosBuffer = buildTemplateBuffer('ALUMNOS', [
            'NOMBRES',
            'APELLIDO_PATERNO',
            'APELLIDO_MATERNO',
            'CARRERA',
            'TURNO',
            'CURP',
            'NO_CONTROL'
          ], [
            'JUAN',
            'PEREZ',
            'LOPEZ',
            'INFORMATICA',
            'MATUTINO',
            'AAAA000000HXXXXX00',
            '00000000000000'
          ]);

          const docenteBuffer = buildTemplateBuffer('DOCENTE', [
            'NOMBRES',
            'APELLIDO_PATERNO',
            'APELLIDO_MATERNO',
            'PUESTO',
            'TURNO',
            'CURP',
            'NUMERO_EMPLEADO'
          ], [
            'MARIA',
            'GARCIA',
            'ROJAS',
            'DOCENTE',
            'VESPERTINO',
            'BBBB000000MXXXXX00',
            '0001'
          ]);

          fs.writeFileSync(alumnosPath, alumnosBuffer);
          fs.writeFileSync(docentePath, docenteBuffer);

          resolve({
            success: true,
            data: {
              targetDir,
              files: [alumnosPath, docentePath]
            }
          });
        } catch (error) {
          resolve({ success: false, error: error.message });
        }
      }).catch((dialogErr) => {
        resolve({ success: false, error: dialogErr.message });
      });
    });
  });

  ipcMain.handle('open-database-folder', async () => {
    return new Promise((resolve) => {
      if (!hasMaintenanceOnlyConfigAccess()) {
        resolve({ success: false, error: 'Solo superadmin puede administrar la base de datos.' });
        return;
      }

      backend.getDatabaseAdminInfo(async (infoErr, info) => {
        if (infoErr) {
          resolve({ success: false, error: infoErr.message });
          return;
        }

        const dbFilePath = String(info?.filePath || '').trim();
        const folderPath = dbFilePath ? path.dirname(dbFilePath) : app.getPath('documents');

        try {
          const result = await shell.openPath(folderPath);
          if (result) {
            resolve({ success: false, error: result });
            return;
          }
          resolve({ success: true, data: { folderPath } });
        } catch (openErr) {
          resolve({ success: false, error: openErr.message });
        }
      });
    });
  });

  ipcMain.handle('execute-sql', async (event, payload) => {
    return new Promise((resolve) => {
      if (!hasMaintenanceOnlyConfigAccess()) {
        resolve({ success: false, error: 'Solo superadmin puede ejecutar SQL manual.' });
        return;
      }

      const sql = String(payload?.sql || '').trim();
      if (!sql) {
        resolve({ success: false, error: 'La sentencia SQL esta vacia.' });
        return;
      }

      backend.executeSql(sql, (err, result) => {
        if (err) {
          resolve({ success: false, error: err.message });
          return;
        }
        resolve({ success: true, data: result || {} });
      });
    });
  });

  ipcMain.handle('update-usuario', async (event, payload) => {
    return new Promise((resolve) => {
      if (!hasSuperCrudAccess()) {
        resolve({ success: false, error: 'Solo administradores o superadmin pueden modificar usuarios.' });
        return;
      }

      const id = Number(payload?.id);
      const username = String(payload?.username || '').trim();
      const nombreCompleto = String(payload?.nombre_completo || '').trim();
      const rol = String(payload?.rol || '').trim();
      const plantelId = Number(payload?.plantel_id);
      const password = String(payload?.password || '').trim();
      const allowedRoles = ['admin', 'capturista'];

      if (!id || Number.isNaN(id) || !username || !nombreCompleto || !allowedRoles.includes(rol) || !plantelId || Number.isNaN(plantelId)) {
        resolve({ success: false, error: 'Datos invalidos para actualizar usuario.' });
        return;
      }

      backend.getUsuarioById(id, (lookupErr, existingUser) => {
        if (lookupErr) {
          resolve({ success: false, error: lookupErr.message });
          return;
        }

        if (existingUser && existingUser.rol === 'superadmin') {
          resolve({ success: false, error: 'El usuario superadmin no se puede modificar desde este modulo.' });
          return;
        }

        backend.updateUsuario(id, {
          username,
          nombre_completo: nombreCompleto,
          rol,
          plantel_id: plantelId,
          password: password || null
        }, (err) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }
          resolve({ success: true });
        });
      });
    });
  });

  ipcMain.handle('delete-usuario', async (event, payload) => {
    return new Promise((resolve) => {
      if (!hasSuperCrudAccess()) {
        resolve({ success: false, error: 'Solo administradores o superadmin pueden eliminar usuarios.' });
        return;
      }

      const id = Number(payload?.id);
      if (!id || Number.isNaN(id)) {
        resolve({ success: false, error: 'ID de usuario invalido.' });
        return;
      }

      if (currentUser && Number(currentUser.id) === id) {
        resolve({ success: false, error: 'No puedes eliminar tu propio usuario en sesion.' });
        return;
      }

      backend.getUsuarioById(id, (lookupErr, existingUser) => {
        if (lookupErr) {
          resolve({ success: false, error: lookupErr.message });
          return;
        }

        if (existingUser && existingUser.rol === 'superadmin') {
          resolve({ success: false, error: 'El usuario superadmin no se puede eliminar desde este modulo.' });
          return;
        }

        backend.deleteUsuario(id, (err) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }
          resolve({ success: true });
        });
      });
    });
  });

  ipcMain.handle('save-alumno', async (event, { data, fotoPath, fotoName, fotoBase64 }) => {
    return new Promise((resolve) => {
      if (!currentUser || !canCreateOrEdit(currentUser.rol)) {
        resolve({ success: false, error: 'No tienes permisos para crear registros.' });
        return;
      }
      const photoPayload = fotoBase64
        ? { dataUrl: fotoBase64, name: fotoName || 'foto_recortada.jpg' }
        : (fotoPath ? { path: fotoPath, name: fotoName } : null);

      const normalizedData = normalizeRecordTextFields(data, [
        'nombres',
        'apellido_paterno',
        'apellido_materno',
        'carrera',
        'turno',
        'curp',
        'no_control',
        'clave',
        'contacto_emergencia'
      ]);
      const actor = getAuditActor();
      normalizedData.created_by = actor;
      normalizedData.updated_by = actor;

      backend.saveAlumno(normalizedData, photoPayload, (err, result) => {
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true });
      });
    });
  });

  ipcMain.handle('update-alumno', async (event, { id, data, fotoPath, fotoName, fotoBase64 }) => {
    return new Promise((resolve) => {
      if (!currentUser || !canCreateOrEdit(currentUser.rol)) {
        resolve({ success: false, error: 'No tienes permisos para editar registros.' });
        return;
      }
      const normalizedData = normalizeRecordTextFields(data, [
        'nombres',
        'apellido_paterno',
        'apellido_materno',
        'carrera',
        'turno',
        'curp',
        'no_control',
        'clave',
        'contacto_emergencia'
      ]);
      normalizedData.updated_by = getAuditActor();

      if (fotoPath || fotoBase64) {
        const photoPayload = fotoBase64
          ? { dataUrl: fotoBase64, name: fotoName || 'foto_recortada.jpg' }
          : { path: fotoPath, name: fotoName };

        backend.saveFotoFile(photoPayload, (err, newFotoPath) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }
          backend.updateAlumno(id, { ...normalizedData, foto: newFotoPath }, (err2) => {
            if (err2) resolve({ success: false, error: err2.message });
            else resolve({ success: true });
          });
        });
      } else {
        backend.updateAlumno(id, normalizedData, (err, result) => {
          if (err) resolve({ success: false, error: err.message });
          else resolve({ success: true });
        });
      }
    });
  });

  ipcMain.handle('delete-alumno', async (event, { id }) => {
    return new Promise((resolve) => {
      if (!currentUser || !canDelete(currentUser.rol)) {
        resolve({ success: false, error: 'No tienes permisos para eliminar registros.' });
        return;
      }
      backend.deleteAlumno(id, (err, result) => {
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true });
      });
    });
  });

  ipcMain.handle('get-empleados', async () => {
    return new Promise((resolve) => {
      backend.getEmpleados((err, results) => {
        if (err) {
          console.error('Error en get-empleados:', err.message);
          resolve({ success: false, data: [], error: err.message });
          return;
        }
        resolve({ success: true, data: results });
      });
    });
  });

  ipcMain.handle('save-empleado', async (event, { data, fotoPath, fotoName, fotoBase64 }) => {
    return new Promise((resolve) => {
      if (!currentUser || !canCreateOrEdit(currentUser.rol)) {
        resolve({ success: false, error: 'No tienes permisos para crear registros.' });
        return;
      }
      const safeData = normalizeRecordTextFields(
        { ...data, telefono: currentUser.plantel_telefono || data.telefono },
        ['nombres', 'apellido_paterno', 'apellido_materno', 'puesto', 'turno', 'curp', 'numero_empleado', 'telefono']
      );
      const actor = getAuditActor();
      safeData.created_by = actor;
      safeData.updated_by = actor;
      const photoPayload = fotoBase64
        ? { dataUrl: fotoBase64, name: fotoName || 'foto_recortada.jpg' }
        : (fotoPath ? { path: fotoPath, name: fotoName } : null);

      backend.saveEmpleado(safeData, photoPayload, (err) => {
        if (err) {
          if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            resolve({ success: false, error: 'El plantel asignado al empleado no existe. Selecciona un plantel valido.' });
            return;
          }
          resolve({ success: false, error: err.message });
        }
        else resolve({ success: true });
      });
    });
  });

  ipcMain.handle('update-empleado', async (event, { id, data, fotoPath, fotoName, fotoBase64 }) => {
    return new Promise((resolve) => {
      if (!currentUser || !canCreateOrEdit(currentUser.rol)) {
        resolve({ success: false, error: 'No tienes permisos para editar registros.' });
        return;
      }
      const safeData = normalizeRecordTextFields(
        { ...data, telefono: currentUser.plantel_telefono || data.telefono },
        ['nombres', 'apellido_paterno', 'apellido_materno', 'puesto', 'turno', 'curp', 'numero_empleado', 'telefono']
      );
      safeData.updated_by = getAuditActor();
      if (fotoPath || fotoBase64) {
        const photoPayload = fotoBase64
          ? { dataUrl: fotoBase64, name: fotoName || 'foto_recortada.jpg' }
          : { path: fotoPath, name: fotoName };

        backend.saveFotoFileInFolder(photoPayload, 'fotos_empleados', (err, newFotoPath) => {
          if (err) {
            resolve({ success: false, error: err.message });
            return;
          }
          backend.updateEmpleado(id, { ...safeData, foto: newFotoPath }, (err2) => {
            if (err2) {
              if (err2.code === 'ER_NO_REFERENCED_ROW_2') {
                resolve({ success: false, error: 'El plantel asignado al empleado no existe. Selecciona un plantel valido.' });
                return;
              }
              resolve({ success: false, error: err2.message });
            }
            else resolve({ success: true });
          });
        });
      } else {
        backend.updateEmpleado(id, safeData, (err) => {
          if (err) {
            if (err.code === 'ER_NO_REFERENCED_ROW_2') {
              resolve({ success: false, error: 'El plantel asignado al empleado no existe. Selecciona un plantel valido.' });
              return;
            }
            resolve({ success: false, error: err.message });
          }
          else resolve({ success: true });
        });
      }
    });
  });

  ipcMain.handle('delete-empleado', async (event, { id }) => {
    return new Promise((resolve) => {
      if (!currentUser || !canDelete(currentUser.rol)) {
        resolve({ success: false, error: 'No tienes permisos para eliminar registros.' });
        return;
      }
      backend.deleteEmpleado(id, (err) => {
        if (err) resolve({ success: false, error: err.message });
        else resolve({ success: true });
      });
    });
  });

  ipcMain.on('login-success', (event, payload) => {
    currentUser = payload && payload.user ? payload.user : null;
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.loadFile('index.html');
  });

  ipcMain.on('logout', () => {
    currentUser = null;
    const win = BrowserWindow.getAllWindows()[0];
    loadAuthEntry(win);
  });

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

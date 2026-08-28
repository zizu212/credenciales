// backend.js
// Lógica Node.js para conexión a MySQL y verificación de usuario

const mysql = require('mysql');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_CONFIG_PATH = path.join(__dirname, 'db.config.json');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');

const DEFAULT_DB_CONFIG = {
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: '',
  database: 'credenciales'
};

let db = null;
let currentDbConfig = null;

function readDbConfig() {
  if (!fs.existsSync(DB_CONFIG_PATH)) {
    return { ...DEFAULT_DB_CONFIG };
  }

  try {
    const fileData = fs.readFileSync(DB_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(fileData);
    return {
      ...DEFAULT_DB_CONFIG,
      ...(parsed || {})
    };
  } catch (error) {
    return { ...DEFAULT_DB_CONFIG };
  }
}

function saveDbConfig(config) {
  const safeConfig = {
    host: config.host || DEFAULT_DB_CONFIG.host,
    port: Number(config.port) || DEFAULT_DB_CONFIG.port,
    user: config.user || DEFAULT_DB_CONFIG.user,
    password: typeof config.password === 'string' ? config.password : DEFAULT_DB_CONFIG.password,
    database: config.database || DEFAULT_DB_CONFIG.database,
    __configured: true
  };

  fs.writeFileSync(DB_CONFIG_PATH, JSON.stringify(safeConfig, null, 2), 'utf8');
  currentDbConfig = safeConfig;
  return safeConfig;
}

function isDbConfigured() {
  if (!fs.existsSync(DB_CONFIG_PATH)) return false;
  try {
    const fileData = fs.readFileSync(DB_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(fileData);
    return Boolean(parsed && parsed.__configured === true);
  } catch (error) {
    return false;
  }
}

function getDbConfig() {
  if (!currentDbConfig) {
    currentDbConfig = readDbConfig();
  }
  return { ...currentDbConfig };
}

function createMysqlConnection(config, useDatabase) {
  const base = {
    host: config.host,
    port: Number(config.port) || 3306,
    user: config.user,
    password: config.password,
    multipleStatements: true
  };
  if (useDatabase) {
    base.database = config.database;
  }
  return mysql.createConnection(base);
}

function closeConnection(connection, callback) {
  if (!connection) {
    callback();
    return;
  }
  connection.end(() => callback());
}

function initializeDatabase(config, callback) {
  const dbConfig = {
    ...DEFAULT_DB_CONFIG,
    ...(config || {})
  };

  const serverConn = createMysqlConnection(dbConfig, false);
  serverConn.connect((serverErr) => {
    if (serverErr) {
      callback(serverErr);
      return;
    }

    serverConn.query(`CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\``, (createDbErr) => {
      closeConnection(serverConn, () => {
        if (createDbErr) {
          callback(createDbErr);
          return;
        }

        const dbConn = createMysqlConnection(dbConfig, true);
        dbConn.connect((dbErr) => {
          if (dbErr) {
            callback(dbErr);
            return;
          }

          if (!fs.existsSync(INIT_SQL_PATH)) {
            closeConnection(dbConn, () => callback(null));
            return;
          }

          const initSql = fs.readFileSync(INIT_SQL_PATH, 'utf8');
          dbConn.query(initSql, (initErr) => {
            closeConnection(dbConn, () => callback(initErr || null));
          });
        });
      });
    });
  });
}

function connectAppDb(callback) {
  const config = getDbConfig();

  if (db) {
    closeConnection(db, () => {
      db = null;
      connectAppDb(callback);
    });
    return;
  }

  db = createMysqlConnection(config, true);
  db.connect((err) => {
    if (err) {
      db = null;
      callback(err);
      return;
    }
    callback(null);
  });
}

function ensureDatabaseReady(config, callback) {
  if (config) {
    saveDbConfig(config);
  }
  const effectiveConfig = getDbConfig();
  initializeDatabase(effectiveConfig, (initErr) => {
    if (initErr) {
      callback(initErr);
      return;
    }
    connectAppDb((connectErr) => {
      if (connectErr) {
        callback(connectErr);
        return;
      }

      // Keep the export log table available even before opening the Reportes view.
      ensureRegistrosTable((tableErr) => {
        if (tableErr) {
          callback(tableErr);
          return;
        }
        callback(null);
      });
    });
  });
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function requireDb(callback) {
  if (db) return true;
  if (typeof callback === 'function') {
    callback(new Error('MySQL no esta configurado o conectado.'));
  }
  return false;
}

function verifyUser(username, password, callback) {
  if (!requireDb(callback)) return;
  const hashed = hashPassword(password);
  db.query(
    'SELECT u.id, u.username, u.nombre_completo, u.rol, u.plantel_id, p.nombre AS plantel_nombre, p.cct AS plantel_cct, p.telefono AS plantel_telefono FROM usuarios u LEFT JOIN planteles p ON p.id = u.plantel_id WHERE u.username = ? AND u.password = ?',
    [username, hashed],
    (err, results) => {
    if (err) return callback(err);
    callback(null, results[0] || null);
  }
  );
}

function createUser(userData, callback) {
  if (!requireDb(callback)) return;
  const hashed = hashPassword(userData.password);
  db.query(
    'INSERT INTO usuarios (username, password, nombre_completo, rol, plantel_id) VALUES (?, ?, ?, ?, ?)',
    [
      userData.username,
      hashed,
      userData.nombre_completo,
      userData.rol,
      userData.plantel_id || null
    ],
    (err, result) => {
    if (err) return callback(err);
    callback(null, true);
  }
  );
}

function countUsers(callback) {
  if (!requireDb(callback)) return;
  db.query('SELECT COUNT(*) AS total FROM usuarios', (err, results) => {
    if (err) return callback(err);
    callback(null, Number(results?.[0]?.total || 0));
  });
}

function countAdminUsers(callback) {
  if (!requireDb(callback)) return;
  db.query("SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'admin'", (err, results) => {
    if (err) return callback(err);
    callback(null, Number(results?.[0]?.total || 0));
  });
}

function getUsuarios(callback) {
  if (!requireDb(callback)) return;
  db.query(
    'SELECT u.id, u.username, u.nombre_completo, u.rol, u.plantel_id, p.nombre AS plantel_nombre FROM usuarios u LEFT JOIN planteles p ON p.id = u.plantel_id ORDER BY u.id DESC',
    callback
  );
}

function updateUsuario(id, data, callback) {
  if (!requireDb(callback)) return;
  const baseParams = [
    data.username,
    data.nombre_completo,
    data.rol,
    data.plantel_id || null
  ];

  if (data.password) {
    const hashed = hashPassword(data.password);
    db.query(
      'UPDATE usuarios SET username=?, nombre_completo=?, rol=?, plantel_id=?, password=? WHERE id=?',
      [...baseParams, hashed, id],
      callback
    );
    return;
  }

  db.query(
    'UPDATE usuarios SET username=?, nombre_completo=?, rol=?, plantel_id=? WHERE id=?',
    [...baseParams, id],
    callback
  );
}

function deleteUsuario(id, callback) {
  if (!requireDb(callback)) return;
  db.query('DELETE FROM usuarios WHERE id = ?', [id], callback);
}

function saveAlumno(data, file, callback) {
  let fotoPath = '';
  if (file) {
    saveFotoFileInFolder(file, 'fotos', (err, dest) => {
      if (err) return callback(err);
      fotoPath = dest;
      insertAlumno(data, fotoPath, callback);
    });
  } else {
    insertAlumno(data, '', callback);
  }
}

function saveFotoFile(file, callback) {
  return saveFotoFileInFolder(file, 'fotos', callback);
}


function deleteOldPhotoHelper(photoPath) {
  if (photoPath && typeof photoPath === 'string') {
    const fs = require('fs');
    try {
      if (fs.existsSync(photoPath)) {
        fs.unlinkSync(photoPath);
      }
    } catch (e) {
      // On Windows, if the image is being displayed in the Electron renderer, 
      // the file will be locked (EBUSY or EPERM). We swallow the error and retry after 5 seconds, 
      // when the modal has closed and the DOM has updated.
      setTimeout(() => {
        try {
          if (fs.existsSync(photoPath)) {
            fs.unlinkSync(photoPath);
          }
        } catch (err) {}
      }, 5000);
    }
  }
}

function saveFotoFileInFolder(file, folderName, callback) {
  if (!file) return callback(null, '');

  const mimeExtMap = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
  };

  const getSafeExtension = () => {
    const ext = path.extname(file.name || '').toLowerCase();
    if (ext && /^\.[a-z0-9]+$/.test(ext)) {
      return ext;
    }
    if (file.dataUrl) {
      const match = String(file.dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);
      if (match && mimeExtMap[match[1]]) {
        return mimeExtMap[match[1]];
      }
    }
    return '.jpg';
  };

  const safeExt = getSafeExtension();
  const folderPath = path.join(__dirname, folderName);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
  const dest = path.join(folderPath, Date.now() + safeExt);

  if (file.dataUrl) {
    const dataUrlMatch = String(file.dataUrl).match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
    if (!dataUrlMatch) {
      callback(new Error('Formato de imagen recortada invalido.'));
      return;
    }
    const buffer = Buffer.from(dataUrlMatch[1], 'base64');
    fs.writeFile(dest, buffer, (err) => {
      if (err) return callback(err);
      callback(null, dest);
    });
    return;
  }

  fs.copyFile(file.path, dest, (err) => {
    if (err) return callback(err);
    callback(null, dest);
  });
}

function hasCarreraIdColumn(callback) {
  if (!requireDb(callback)) return;
  db.query("SHOW COLUMNS FROM alumnos LIKE 'carrera_id'", (err, results) => {
    if (err) return callback(err);
    callback(null, Array.isArray(results) && results.length > 0);
  });
}

function ensureColumns(tableName, requiredColumns, callback) {
  if (!requireDb(callback)) return;
  db.query(`SHOW COLUMNS FROM ${tableName}`, (err, results) => {
    if (err) return callback(err);

    const existing = new Set((results || []).map((col) => String(col.Field || '').toLowerCase()));
    const pending = Object.entries(requiredColumns).filter(([name]) => !existing.has(String(name).toLowerCase()));

    if (!pending.length) {
      callback(null);
      return;
    }

    const addNext = (index) => {
      if (index >= pending.length) {
        callback(null);
        return;
      }

      const [columnName, definition] = pending[index];
      const sql = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`;
      db.query(sql, (alterErr) => {
        if (alterErr) return callback(alterErr);
        addNext(index + 1);
      });
    };

    addNext(0);
  });
}

function ensureAlumnosAuditColumns(callback) {
  ensureColumns('alumnos', {
    created_at: 'DATETIME NULL',
    updated_at: 'DATETIME NULL',
    created_by: 'VARCHAR(120) NULL',
    updated_by: 'VARCHAR(120) NULL'
  }, callback);
}

function ensureEmpleadosAuditColumns(callback) {
  ensureColumns('empleados', {
    created_at: 'DATETIME NULL',
    updated_at: 'DATETIME NULL',
    created_by: 'VARCHAR(120) NULL',
    updated_by: 'VARCHAR(120) NULL'
  }, callback);
}

function ensureRegistrosTable(callback) {
  if (!requireDb(callback)) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS registros (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombre_archivo VARCHAR(255) NOT NULL,
      cantidad_registros INT NOT NULL,
      tipo_exportacion ENUM('ALUMNOS','EMPLEADOS') NOT NULL,
      usuario_creador VARCHAR(120) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  db.query(sql, callback);
}

function saveExportRegistro(data, callback) {
  ensureRegistrosTable((tableErr) => {
    if (tableErr) return callback(tableErr);
    db.query(
      'INSERT INTO registros (nombre_archivo, cantidad_registros, tipo_exportacion, usuario_creador) VALUES (?, ?, ?, ?)',
      [
        data.nombre_archivo,
        Number(data.cantidad_registros) || 0,
        String(data.tipo_exportacion || '').toUpperCase(),
        data.usuario_creador || 'SISTEMA'
      ],
      callback
    );
  });
}

function getExportRegistros(callback) {
  ensureRegistrosTable((tableErr) => {
    if (tableErr) return callback(tableErr);
    db.query('SELECT id, nombre_archivo, cantidad_registros, tipo_exportacion, usuario_creador, created_at FROM registros ORDER BY id DESC', callback);
  });
}

function insertAlumno(data, fotoPath, callback) {
  ensureAlumnosAuditColumns((auditErr) => {
    if (auditErr) return callback(auditErr);

    hasCarreraIdColumn((schemaErr, useCarreraId) => {
    if (schemaErr) return callback(schemaErr);

    const sql = useCarreraId
      ? 'INSERT INTO alumnos (nombres, apellido_paterno, apellido_materno, carrera_id, turno, plantel_id, curp, no_control, clave, no_foto, foto, contacto_emergencia, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())'
      : 'INSERT INTO alumnos (nombres, apellido_paterno, apellido_materno, carrera, turno, plantel_id, curp, no_control, clave, no_foto, foto, contacto_emergencia, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())';

    const carreraValue = useCarreraId ? data.carrera_id : data.carrera;
    db.query(
      sql,
      [
        data.nombres,
        data.apellido_paterno,
        data.apellido_materno,
        carreraValue,
        data.turno,
        data.plantel_id,
        data.curp,
        data.no_control,
        data.clave,
        data.no_foto,
        fotoPath,
        data.contacto_emergencia,
        data.created_by || null,
        data.updated_by || null
      ],
      callback
    );
    });
  });
}

function getAlumnos(callback) {
  ensureAlumnosAuditColumns((auditErr) => {
    if (auditErr) return callback(auditErr);

    hasCarreraIdColumn((schemaErr, useCarreraId) => {
    if (schemaErr) return callback(schemaErr);

    const sql = useCarreraId
      ? 'SELECT a.*, p.nombre AS plantel_nombre, c.nombre_carrera AS carrera_nombre FROM alumnos a LEFT JOIN planteles p ON p.id = a.plantel_id LEFT JOIN carreras c ON c.id = a.carrera_id ORDER BY a.id DESC'
      : 'SELECT a.*, p.nombre AS plantel_nombre, a.carrera AS carrera_nombre FROM alumnos a LEFT JOIN planteles p ON p.id = a.plantel_id ORDER BY a.id DESC';

    db.query(sql, callback);
    });
  });
}

function getPlanteles(callback) {
  if (!requireDb(callback)) return;
  db.query('SELECT id, nombre, cct, telefono FROM planteles ORDER BY nombre ASC', callback);
}

function savePlantel(data, callback) {
  if (!requireDb(callback)) return;
  db.query(
    'INSERT INTO planteles (nombre, cct, telefono) VALUES (?, ?, ?)',
    [data.nombre, data.cct, data.telefono || null],
    callback
  );
}

function updatePlantel(id, data, callback) {
  if (!requireDb(callback)) return;
  db.query(
    'UPDATE planteles SET nombre=?, cct=?, telefono=? WHERE id=?',
    [data.nombre, data.cct, data.telefono || null, id],
    callback
  );
}

function deletePlantel(id, callback) {
  if (!requireDb(callback)) return;
  db.query('DELETE FROM planteles WHERE id=?', [id], callback);
}

function getTurnos(callback) {
  if (!requireDb(callback)) return;
  db.query('SELECT id, nombre_turno FROM turno ORDER BY id ASC', callback);
}

function getCarreras(callback) {
  if (!requireDb(callback)) return;
  db.query('SELECT id, nombre_carrera FROM carreras ORDER BY nombre_carrera ASC', callback);
}

function saveCarrera(data, callback) {
  if (!requireDb(callback)) return;
  db.query('INSERT INTO carreras (nombre_carrera) VALUES (?)', [data.nombre_carrera], callback);
}

function updateCarrera(id, data, callback) {
  if (!requireDb(callback)) return;
  db.query('UPDATE carreras SET nombre_carrera=? WHERE id=?', [data.nombre_carrera, id], callback);
}

function deleteCarrera(id, callback) {
  if (!requireDb(callback)) return;
  db.query('DELETE FROM carreras WHERE id=?', [id], callback);
}

function deleteAlumno(id, callback) {
  if (!requireDb(callback)) return;
  db.query('DELETE FROM alumnos WHERE id = ?', [id], callback);
}

function updateAlumno(id, data, callback) {
  get('SELECT foto FROM alumnos WHERE id = ?', [id], (err, row) => {
    if (!err && row && row.foto && data.foto && data.foto !== row.foto) {
      deleteOldPhotoHelper(row.foto);
    }
    ensureAlumnosAuditColumns((auditErr) => {
    if (auditErr) return callback(auditErr);

    hasCarreraIdColumn((schemaErr, useCarreraId) => {
    if (schemaErr) return callback(schemaErr);

    const sql = useCarreraId
      ? 'UPDATE alumnos SET nombres=?, apellido_paterno=?, apellido_materno=?, carrera_id=?, turno=?, plantel_id=?, curp=?, no_control=?, clave=?, no_foto=?, foto=?, contacto_emergencia=?, updated_by=?, updated_at=NOW() WHERE id=?'
      : 'UPDATE alumnos SET nombres=?, apellido_paterno=?, apellido_materno=?, carrera=?, turno=?, plantel_id=?, curp=?, no_control=?, clave=?, no_foto=?, foto=?, contacto_emergencia=?, updated_by=?, updated_at=NOW() WHERE id=?';

    const carreraValue = useCarreraId ? data.carrera_id : data.carrera;
    db.query(
      sql,
      [
        data.nombres,
        data.apellido_paterno,
        data.apellido_materno,
        carreraValue,
        data.turno,
        data.plantel_id,
        data.curp,
        data.no_control,
        data.clave,
        data.no_foto,
        data.foto,
        data.contacto_emergencia,
        data.updated_by || null,
        id
      ],
      callback
    );
    });
  });
  });
}

function saveEmpleado(data, file, callback) {
  ensureEmpleadosTable((tableErr) => {
    if (tableErr) return callback(tableErr);

    if (file) {
      saveFotoFileInFolder(file, 'fotos_empleados', (err, fotoPath) => {
        if (err) return callback(err);
        insertEmpleado(data, fotoPath, callback);
      });
    } else {
      insertEmpleado(data, '', callback);
    }
  });
}

function ensureEmpleadosTable(callback) {
  if (!requireDb(callback)) return;
  const sql = `
    CREATE TABLE IF NOT EXISTS empleados (
      id INT AUTO_INCREMENT PRIMARY KEY,
      nombres VARCHAR(100) NOT NULL,
      apellido_paterno VARCHAR(50) NOT NULL,
      apellido_materno VARCHAR(50) NOT NULL,
      puesto VARCHAR(100) NOT NULL,
      turno VARCHAR(20) NOT NULL,
      plantel_id INT NOT NULL,
      curp VARCHAR(20) NOT NULL,
      numero_empleado VARCHAR(30) NOT NULL,
      telefono VARCHAR(20) NOT NULL,
      foto VARCHAR(255),
      FOREIGN KEY (plantel_id) REFERENCES planteles(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  db.query(sql, callback);
}

function insertEmpleado(data, fotoPath, callback) {
  ensureEmpleadosAuditColumns((auditErr) => {
    if (auditErr) return callback(auditErr);
    db.query(
      'INSERT INTO empleados (nombres, apellido_paterno, apellido_materno, puesto, turno, plantel_id, curp, numero_empleado, telefono, foto, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [
        data.nombres,
        data.apellido_paterno,
        data.apellido_materno,
        data.puesto,
        data.turno,
        data.plantel_id,
        data.curp,
        data.numero_empleado,
        data.telefono,
        fotoPath,
        data.created_by || null,
        data.updated_by || null
      ],
      callback
    );
  });
}

function getEmpleados(callback) {
  ensureEmpleadosTable((tableErr) => {
    if (tableErr) return callback(tableErr);
    ensureEmpleadosAuditColumns((auditErr) => {
      if (auditErr) return callback(auditErr);
      db.query(
        'SELECT e.*, p.nombre AS plantel_nombre, p.cct AS plantel_cct FROM empleados e LEFT JOIN planteles p ON p.id = e.plantel_id ORDER BY e.id DESC',
        callback
      );
    });
  });
}

function updateEmpleado(id, data, callback) {
  get('SELECT foto FROM empleados WHERE id = ?', [id], (err, row) => {
    if (!err && row && row.foto && data.foto && data.foto !== row.foto) {
      deleteOldPhotoHelper(row.foto);
    }
    ensureEmpleadosTable((tableErr) => {
    if (tableErr) return callback(tableErr);
    ensureEmpleadosAuditColumns((auditErr) => {
      if (auditErr) return callback(auditErr);
      db.query(
        'UPDATE empleados SET nombres=?, apellido_paterno=?, apellido_materno=?, puesto=?, turno=?, plantel_id=?, curp=?, numero_empleado=?, telefono=?, foto=?, updated_by=?, updated_at=NOW() WHERE id=?',
        [
          data.nombres,
          data.apellido_paterno,
          data.apellido_materno,
          data.puesto,
          data.turno,
          data.plantel_id,
          data.curp,
          data.numero_empleado,
          data.telefono,
          data.foto,
          data.updated_by || null,
          id
        ],
        callback
      );
    });
  });
}

function deleteEmpleado(id, callback) {
  ensureEmpleadosTable((tableErr) => {
    if (tableErr) return callback(tableErr);
    db.query('DELETE FROM empleados WHERE id = ?', [id], callback);
  });
}


function getUsuarioById(id, callback) {
  if (!requireDb(callback)) return;
  get('SELECT * FROM usuarios WHERE id = ?', [id], callback);
}

module.exports = {
  getUsuarioById,
  getDbConfig,
  isDbConfigured,
  saveDbConfig,
  ensureDatabaseReady,
  initializeDatabase,
  verifyUser,
  createUser,
  countUsers,
  countAdminUsers,
  getUsuarios,
  updateUsuario,
  deleteUsuario,
  saveAlumno,
  saveFotoFile,
  saveFotoFileInFolder,
  getAlumnos,
  getPlanteles,
  savePlantel,
  updatePlantel,
  deletePlantel,
  getTurnos,
  getCarreras,
  saveCarrera,
  updateCarrera,
  deleteCarrera,
  deleteAlumno,
  updateAlumno,
  saveEmpleado,
  getEmpleados,
  updateEmpleado,
  deleteEmpleado,
  saveExportRegistro,
  getExportRegistros
};

USE credenciales;

ALTER TABLE usuarios
  ADD COLUMN nombre_completo VARCHAR(120) NOT NULL DEFAULT 'Sin nombre',
  ADD COLUMN rol ENUM('admin','capturista','consulta') NOT NULL DEFAULT 'consulta',
  ADD COLUMN plantel_id INT NULL,
  ADD CONSTRAINT fk_usuarios_plantel FOREIGN KEY (plantel_id) REFERENCES planteles(id);

-- Ajuste opcional para usuarios existentes.
UPDATE usuarios
SET nombre_completo = IFNULL(NULLIF(nombre_completo, ''), username)
WHERE nombre_completo = 'Sin nombre' OR nombre_completo IS NULL;

-- Asignar rol admin al usuario admin existente.
UPDATE usuarios
SET rol = 'admin', plantel_id = 1
WHERE LOWER(username) = 'admin';

-- Agregar telefono en planteles para autocompletar telefono de contacto.
ALTER TABLE planteles
  ADD COLUMN telefono VARCHAR(20) NULL;

-- Datos base de ejemplo para planteles existentes (ajusta segun tu contexto).
UPDATE planteles SET telefono = '5551000001' WHERE id = 1 AND (telefono IS NULL OR telefono = '');
UPDATE planteles SET telefono = '5551000002' WHERE id = 2 AND (telefono IS NULL OR telefono = '');

-- Tabla de turnos
CREATE TABLE IF NOT EXISTS turno (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre_turno VARCHAR(30) NOT NULL UNIQUE
);

INSERT IGNORE INTO turno (nombre_turno) VALUES ('MATUTINO');
INSERT IGNORE INTO turno (nombre_turno) VALUES ('VESPERTINO');

-- ================================
-- Reparacion para funcionamiento
-- ================================

-- 1) Asegurar columna carrera_id en alumnos.
ALTER TABLE alumnos
  ADD COLUMN IF NOT EXISTS carrera_id INT NULL;

-- 2) Mapear textos existentes de alumnos.carrera al catalogo carreras.
UPDATE alumnos a
LEFT JOIN carreras c ON UPPER(TRIM(c.nombre_carrera)) = UPPER(TRIM(a.carrera))
SET a.carrera_id = c.id
WHERE (a.carrera_id IS NULL OR a.carrera_id = 0);

-- 3) Si aun hay nulos, usar una carrera por defecto.
UPDATE alumnos
SET carrera_id = (SELECT id FROM carreras ORDER BY id ASC LIMIT 1)
WHERE carrera_id IS NULL OR carrera_id = 0;

-- 4) Crear FK de carrera solo si no existe.
SET @fk_carrera_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'alumnos'
    AND CONSTRAINT_NAME = 'fk_alumnos_carrera'
);
SET @sql_fk_carrera := IF(
  @fk_carrera_exists = 0,
  'ALTER TABLE alumnos ADD CONSTRAINT fk_alumnos_carrera FOREIGN KEY (carrera_id) REFERENCES carreras(id)',
  'SELECT 1'
);
PREPARE stmt_fk_carrera FROM @sql_fk_carrera;
EXECUTE stmt_fk_carrera;
DEALLOCATE PREPARE stmt_fk_carrera;

-- 5) Corregir plantel_id en usuarios/alumnos si apunta a IDs inexistentes.
UPDATE usuarios u
LEFT JOIN planteles p ON p.id = u.plantel_id
SET u.plantel_id = (SELECT id FROM planteles ORDER BY id ASC LIMIT 1)
WHERE u.plantel_id IS NULL OR p.id IS NULL;

UPDATE alumnos a
LEFT JOIN planteles p ON p.id = a.plantel_id
SET a.plantel_id = (SELECT id FROM planteles ORDER BY id ASC LIMIT 1)
WHERE a.plantel_id IS NULL OR p.id IS NULL;

-- 6) Crear tabla empleados.
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
);

-- Normalizacion de alumnos.carrera hacia alumnos.carrera_id.
ALTER TABLE alumnos
  ADD COLUMN carrera_id INT NULL;

UPDATE alumnos a
LEFT JOIN carreras c ON UPPER(TRIM(c.nombre_carrera)) = UPPER(TRIM(a.carrera))
SET a.carrera_id = c.id
WHERE a.carrera_id IS NULL;

-- Si quedaran carreras sin catalogo, asignar una por defecto (primera disponible).
UPDATE alumnos
SET carrera_id = (SELECT MIN(id) FROM carreras)
WHERE carrera_id IS NULL;

ALTER TABLE alumnos
  ADD CONSTRAINT fk_alumnos_carrera FOREIGN KEY (carrera_id) REFERENCES carreras(id);

-- 7) Campos de auditoria para alumnos y empleados.
ALTER TABLE alumnos
  ADD COLUMN IF NOT EXISTS created_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS updated_by VARCHAR(120) NULL;

ALTER TABLE empleados
  ADD COLUMN IF NOT EXISTS created_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS created_by VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS updated_by VARCHAR(120) NULL;

CREATE TABLE IF NOT EXISTS registros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre_archivo VARCHAR(255) NOT NULL,
  cantidad_registros INT NOT NULL,
  tipo_exportacion ENUM('ALUMNOS','EMPLEADOS') NOT NULL,
  usuario_creador VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

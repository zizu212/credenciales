CREATE TABLE IF NOT EXISTS planteles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  cct VARCHAR(20) NOT NULL UNIQUE,
  telefono VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS carreras (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre_carrera VARCHAR(120) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS turno (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre_turno VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(64) NOT NULL,
  nombre_completo VARCHAR(120) NOT NULL,
  rol ENUM('admin','capturista','consulta') NOT NULL DEFAULT 'consulta',
  plantel_id INT NULL,
  FOREIGN KEY (plantel_id) REFERENCES planteles(id)
);

CREATE TABLE IF NOT EXISTS alumnos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombres VARCHAR(100) NOT NULL,
  apellido_paterno VARCHAR(50) NOT NULL,
  apellido_materno VARCHAR(50) NOT NULL,
  carrera_id INT NULL,
  carrera VARCHAR(120) NULL,
  turno VARCHAR(20) NOT NULL,
  plantel_id INT NOT NULL,
  curp VARCHAR(20) NOT NULL,
  no_control VARCHAR(20) NOT NULL,
  clave VARCHAR(20) NOT NULL,
  no_foto VARCHAR(20),
  foto VARCHAR(255),
  contacto_emergencia VARCHAR(100),
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  created_by VARCHAR(120) NULL,
  updated_by VARCHAR(120) NULL,
  FOREIGN KEY (plantel_id) REFERENCES planteles(id)
);

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
  created_at DATETIME NULL,
  updated_at DATETIME NULL,
  created_by VARCHAR(120) NULL,
  updated_by VARCHAR(120) NULL,
  FOREIGN KEY (plantel_id) REFERENCES planteles(id)
);

CREATE TABLE IF NOT EXISTS registros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre_archivo VARCHAR(255) NOT NULL,
  cantidad_registros INT NOT NULL,
  tipo_exportacion ENUM('ALUMNOS','EMPLEADOS') NOT NULL,
  usuario_creador VARCHAR(120) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS carrera_id INT NULL;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS carrera VARCHAR(120) NULL;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS created_at DATETIME NULL;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS updated_at DATETIME NULL;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS created_by VARCHAR(120) NULL;
ALTER TABLE alumnos ADD COLUMN IF NOT EXISTS updated_by VARCHAR(120) NULL;

ALTER TABLE empleados ADD COLUMN IF NOT EXISTS created_at DATETIME NULL;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS updated_at DATETIME NULL;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS created_by VARCHAR(120) NULL;
ALTER TABLE empleados ADD COLUMN IF NOT EXISTS updated_by VARCHAR(120) NULL;

INSERT IGNORE INTO turno (nombre_turno) VALUES ('MATUTINO');
INSERT IGNORE INTO turno (nombre_turno) VALUES ('VESPERTINO');

INSERT IGNORE INTO carreras (id, nombre_carrera) VALUES (1, 'INGENIERIA EN SISTEMAS');
INSERT IGNORE INTO carreras (id, nombre_carrera) VALUES (2, 'ADMINISTRACION');

INSERT IGNORE INTO planteles (id, nombre, cct, telefono) VALUES (1, 'PLANTEL CENTRAL', 'CCT001', '5551000001');
INSERT IGNORE INTO planteles (id, nombre, cct, telefono) VALUES (2, 'PLANTEL NORTE', 'CCT002', '5551000002');

INSERT IGNORE INTO usuarios (username, password, nombre_completo, rol, plantel_id)
VALUES ('Admin', '03ac674216f3e15c761ee1a5e255f067953623c8d3c3d7a7a8e6c2c7a2a7b2a7', 'Administrador del Sistema', 'admin', 1);

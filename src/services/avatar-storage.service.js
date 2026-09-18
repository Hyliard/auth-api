const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const FILENAME_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function getStorageDir() {
  return path.resolve(process.env.AVATAR_STORAGE_DIR
    || path.join(__dirname, '..', '..', 'uploads', 'avatars'));
}

function resolveFilename(filename) {
  if (typeof filename !== 'string' || !FILENAME_REGEX.test(filename)) return null;
  const storageDir = getStorageDir();
  const filePath = path.resolve(storageDir, filename);
  if (path.dirname(filePath) !== storageDir) return null;
  return filePath;
}

async function saveAvatar(buffer, extension) {
  if (!Object.prototype.hasOwnProperty.call(MIME_BY_EXTENSION, extension)) {
    throw new Error('Unsupported avatar extension');
  }
  const storageDir = getStorageDir();
  await fs.mkdir(storageDir, { recursive: true, mode: 0o700 });
  const filename = `${randomUUID()}.${extension}`;
  const finalPath = resolveFilename(filename);
  const temporaryPath = path.join(storageDir, `.${filename}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, buffer, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporaryPath, finalPath);
  } catch (err) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw err;
  }
  return filename;
}

async function getAvatarFile(filename) {
  const filePath = resolveFilename(filename);
  if (!filePath) return null;
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return null;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  const extension = path.extname(filename).slice(1);
  return { filePath, contentType: MIME_BY_EXTENSION[extension] };
}

async function deleteAvatar(filename) {
  if (!filename) return true;
  const filePath = resolveFilename(filename);
  if (!filePath) return false;
  try {
    await fs.unlink(filePath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
}

async function deleteAvatarBestEffort(filename) {
  try {
    return await deleteAvatar(filename);
  } catch {
    console.error({ type: 'AvatarCleanupError', message: 'No se pudo eliminar un archivo de avatar obsoleto' });
    return false;
  }
}

module.exports = {
  getStorageDir,
  saveAvatar,
  getAvatarFile,
  deleteAvatar,
  deleteAvatarBestEffort,
};

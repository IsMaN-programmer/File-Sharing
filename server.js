const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const crypto = require("crypto");

const express = require("express");
const multer = require("multer");
const archiver = require("archiver");

const app = express();

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "shares.json");
const STORAGE_DIR = path.join(ROOT_DIR, "storage");
const TMP_DIR = path.join(STORAGE_DIR, "tmp");
const UPLOADS_DIR = path.join(STORAGE_DIR, "uploads");
const ARCHIVES_DIR = path.join(STORAGE_DIR, "archives");

const MAX_FILE_SIZE = 512 * 1024 * 1024;
const MAX_ARCHIVE_SIZE = 512 * 1024 * 1024;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const MODE_RULES = {
  one_time: { label: "One-time", ttlMs: null },
  seven_days: { label: "7 days", ttlMs: 7 * 24 * 60 * 60 * 1000 },
  hundred_days: { label: "100 days", ttlMs: 100 * 24 * 60 * 60 * 1000 }
};

const upload = multer({
  dest: TMP_DIR,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 100
  }
});

let storeQueue = Promise.resolve();

function toUnixPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function sanitizeFileName(fileName) {
  return fileName
    .normalize("NFKC")
    .replace(/[<>:"\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim() || "file";
}

function humanMode(mode) {
  return MODE_RULES[mode] ? MODE_RULES[mode].label : mode;
}

function calcExpiry(mode, createdAt) {
  const ttlMs = MODE_RULES[mode].ttlMs;
  if (!ttlMs) {
    return null;
  }

  return createdAt + ttlMs;
}

function isExpired(share, now = Date.now()) {
  return typeof share.expiresAt === "number" && share.expiresAt <= now;
}

async function ensureEnvironment() {
  await Promise.all([
    fsp.mkdir(DATA_DIR, { recursive: true }),
    fsp.mkdir(TMP_DIR, { recursive: true }),
    fsp.mkdir(UPLOADS_DIR, { recursive: true }),
    fsp.mkdir(ARCHIVES_DIR, { recursive: true })
  ]);

  try {
    await fsp.access(DATA_FILE, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(DATA_FILE, "{}", "utf8");
  }
}

async function readSharesUnsafe() {
  try {
    const raw = await fsp.readFile(DATA_FILE, "utf8");
    if (!raw.trim()) {
      return {};
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function writeSharesUnsafe(shares) {
  await fsp.writeFile(DATA_FILE, JSON.stringify(shares, null, 2), "utf8");
}

async function readShares() {
  await storeQueue;
  return readSharesUnsafe();
}

function mutateShares(mutator) {
  const job = storeQueue.then(async () => {
    const shares = await readSharesUnsafe();
    const result = await mutator(shares);
    await writeSharesUnsafe(shares);
    return result;
  });

  storeQueue = job.catch((error) => {
    console.error("Store queue error:", error);
  });

  return job;
}

async function safeUnlink(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function moveFile(sourcePath, targetPath) {
  try {
    await fsp.rename(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== "EXDEV") {
      throw error;
    }

    await fsp.copyFile(sourcePath, targetPath);
    await safeUnlink(sourcePath);
  }
}

async function removeTmpFiles(files) {
  await Promise.all(
    files.map(async (file) => {
      if (!file || !file.path) {
        return;
      }

      await safeUnlink(file.path);
    })
  );
}

async function createZipArchive(sourceFiles, archiveAbsolutePath) {
  await fsp.mkdir(path.dirname(archiveAbsolutePath), { recursive: true });

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(archiveAbsolutePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    const onError = (error) => {
      output.destroy();
      reject(error);
    };

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", onError);

    archive.pipe(output);

    sourceFiles.forEach((file, index) => {
      const entryName = `${String(index + 1).padStart(2, "0")}-${sanitizeFileName(file.originalname)}`;
      archive.file(file.path, { name: entryName });
    });

    archive.finalize();
  });
}

async function deleteShareAssets(share) {
  if (!share) {
    return;
  }

  if (share.assetType === "archive" && share.archive && share.archive.relativePath) {
    const archivePath = path.join(ROOT_DIR, share.archive.relativePath);
    await safeUnlink(archivePath);
    return;
  }

  if (share.assetType === "files" && share.folderRelativePath) {
    const folderPath = path.join(ROOT_DIR, share.folderRelativePath);
    await fsp.rm(folderPath, { recursive: true, force: true });
    return;
  }

  if (Array.isArray(share.files)) {
    await Promise.all(
      share.files.map(async (file) => {
        if (file.relativePath) {
          await safeUnlink(path.join(ROOT_DIR, file.relativePath));
        }
      })
    );
  }
}

function buildDownloadUrl(req, shareId) {
  return `${req.protocol}://${req.get("host")}/d/${shareId}`;
}

function serializeShare(share, req) {
  return {
    id: share.id,
    mode: share.mode,
    modeLabel: humanMode(share.mode),
    createdAt: share.createdAt,
    expiresAt: share.expiresAt,
    downloadCount: share.downloadCount || 0,
    isArchive: share.assetType === "archive",
    fileCount: share.assetType === "archive" ? (share.sourceFiles || []).length : (share.files || []).length,
    downloadUrl: buildDownloadUrl(req, share.id),
    oneTime: share.mode === "one_time"
  };
}

async function completeDownload(shareId) {
  await mutateShares(async (shares) => {
    const share = shares[shareId];
    if (!share) {
      return;
    }

    share.downloadCount = (share.downloadCount || 0) + 1;
    share.lastDownloadedAt = Date.now();

    if (share.mode === "one_time") {
      await deleteShareAssets(share);
      delete shares[shareId];
    }
  });
}

async function cleanupExpiredShares() {
  const now = Date.now();

  await mutateShares(async (shares) => {
    const entries = Object.entries(shares);

    for (const [shareId, share] of entries) {
      if (isExpired(share, now)) {
        await deleteShareAssets(share);
        delete shares[shareId];
      }
    }
  });
}

function sendFileAndTrackDownload(res, share, fileMeta, absolutePath) {
  res.download(absolutePath, fileMeta.originalName, async (error) => {
    if (error) {
      if (!res.headersSent) {
        res.status(500).send("Download failed.");
      }
      return;
    }

    try {
      await completeDownload(share.id);
    } catch (downloadTrackError) {
      console.error("Download tracking error:", downloadTrackError);
    }
  });
}

function renderMultiFilePage(share, req) {
  const files = share.files || [];
  const itemMarkup = files
    .map((file, index) => {
      const href = `/d/${share.id}/file/${index}`;
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      return `<li><a href="${href}">${file.originalName}</a> <span>${sizeMb} MB</span></li>`;
    })
    .join("\n");

  const modeText = humanMode(share.mode);
  const expiry = share.expiresAt ? new Date(share.expiresAt).toLocaleString("en-US") : "after first download";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>File Download ${share.id}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      font-family: "Segoe UI", sans-serif;
      background: linear-gradient(135deg, #f5efe6 0%, #d9ece6 100%);
      color: #1f2937;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .card {
      width: min(760px, 100%);
      background: #ffffff;
      border-radius: 20px;
      box-shadow: 0 20px 40px rgba(15, 23, 42, 0.12);
      padding: 24px;
    }
    h1 { margin-top: 0; }
    ul { list-style: none; padding: 0; margin: 20px 0 0; display: grid; gap: 12px; }
    li {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 12px 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    a {
      color: #0f766e;
      font-weight: 600;
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
    span { color: #475569; font-size: 0.9rem; }
  </style>
</head>
<body>
  <article class="card">
    <h1>Files</h1>
    <p><strong>Mode:</strong> ${modeText}</p>
    <p><strong>Available until:</strong> ${expiry}</p>
    <ul>${itemMarkup}</ul>
    <p style="margin-top: 20px; color: #64748b;">Link: ${buildDownloadUrl(req, share.id)}</p>
  </article>
</body>
</html>`;
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT_DIR, "public")));

app.get("/api/limits", (req, res) => {
  res.json({
    maxFileSizeBytes: MAX_FILE_SIZE,
    maxArchiveSizeBytes: MAX_ARCHIVE_SIZE
  });
});

app.get("/api/shares", async (req, res, next) => {
  try {
    await cleanupExpiredShares();
    const shares = await readShares();
    const list = Object.values(shares)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map((share) => serializeShare(share, req));

    res.json({ shares: list });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/shares/:id", async (req, res, next) => {
  try {
    const result = await mutateShares(async (shares) => {
      const share = shares[req.params.id];
      if (!share) {
        return { removed: false };
      }

      await deleteShareAssets(share);
      delete shares[req.params.id];
      return { removed: true };
    });

    if (!result.removed) {
      return res.status(404).json({ error: "Link not found." });
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/upload", upload.array("files", 100), async (req, res, next) => {
  const uploadedFiles = req.files || [];

  try {
    await cleanupExpiredShares();

    const mode = req.body.mode;
    const shouldArchive = String(req.body.archive || "false").toLowerCase() === "true";

    if (!MODE_RULES[mode]) {
      await removeTmpFiles(uploadedFiles);
      return res.status(400).json({ error: "Invalid download mode." });
    }

    if (!uploadedFiles.length) {
      return res.status(400).json({ error: "Upload at least one file." });
    }

    const shareId = crypto.randomUUID();
    const createdAt = Date.now();
    const expiresAt = calcExpiry(mode, createdAt);
    const totalUploadSize = uploadedFiles.reduce((sum, file) => sum + file.size, 0);

    let shareRecord;

    if (shouldArchive) {
      if (totalUploadSize > MAX_ARCHIVE_SIZE) {
        await removeTmpFiles(uploadedFiles);
        return res.status(400).json({ error: "Total archive input must be <= 512 MB." });
      }

      const archiveRelativePath = toUnixPath(path.join("storage", "archives", `${shareId}.zip`));
      const archiveAbsolutePath = path.join(ROOT_DIR, archiveRelativePath);

      await createZipArchive(uploadedFiles, archiveAbsolutePath);
      const archiveStats = await fsp.stat(archiveAbsolutePath);

      if (archiveStats.size > MAX_ARCHIVE_SIZE) {
        await safeUnlink(archiveAbsolutePath);
        await removeTmpFiles(uploadedFiles);
        return res.status(400).json({ error: "Final archive exceeded 512 MB." });
      }

      await removeTmpFiles(uploadedFiles);

      shareRecord = {
        id: shareId,
        mode,
        createdAt,
        expiresAt,
        downloadCount: 0,
        assetType: "archive",
        archive: {
          originalName: `files-${shareId}.zip`,
          relativePath: archiveRelativePath,
          size: archiveStats.size,
          mimeType: "application/zip"
        },
        sourceFiles: uploadedFiles.map((file) => ({
          originalName: file.originalname,
          size: file.size,
          mimeType: file.mimetype
        }))
      };
    } else {
      const shareFolderRelativePath = toUnixPath(path.join("storage", "uploads", shareId));
      const shareFolderAbsolutePath = path.join(ROOT_DIR, shareFolderRelativePath);
      await fsp.mkdir(shareFolderAbsolutePath, { recursive: true });

      const normalizedFiles = [];

      for (let index = 0; index < uploadedFiles.length; index += 1) {
        const file = uploadedFiles[index];
        const targetName = `${String(index + 1).padStart(2, "0")}-${sanitizeFileName(file.originalname)}`;
        const targetAbsolutePath = path.join(shareFolderAbsolutePath, targetName);
        await moveFile(file.path, targetAbsolutePath);

        normalizedFiles.push({
          originalName: file.originalname,
          relativePath: toUnixPath(path.join(shareFolderRelativePath, targetName)),
          size: file.size,
          mimeType: file.mimetype
        });
      }

      shareRecord = {
        id: shareId,
        mode,
        createdAt,
        expiresAt,
        downloadCount: 0,
        assetType: "files",
        folderRelativePath: shareFolderRelativePath,
        files: normalizedFiles
      };
    }

    await mutateShares(async (shares) => {
      shares[shareId] = shareRecord;
    });

    return res.status(201).json({
      share: serializeShare(shareRecord, req),
      message: "Upload complete."
    });
  } catch (error) {
    await removeTmpFiles(uploadedFiles);
    return next(error);
  }
});

app.get("/d/:id", async (req, res, next) => {
  try {
    await cleanupExpiredShares();
    const shares = await readShares();
    const share = shares[req.params.id];

    if (!share) {
      return res.status(404).send("Link not found or expired.");
    }

    if (share.assetType === "archive") {
      const archiveMeta = share.archive;
      const archiveAbsolutePath = path.join(ROOT_DIR, archiveMeta.relativePath);
      return sendFileAndTrackDownload(res, share, archiveMeta, archiveAbsolutePath);
    }

    if (!Array.isArray(share.files) || share.files.length === 0) {
      return res.status(410).send("Files are unavailable.");
    }

    if (share.files.length === 1) {
      const fileMeta = share.files[0];
      const fileAbsolutePath = path.join(ROOT_DIR, fileMeta.relativePath);
      return sendFileAndTrackDownload(res, share, fileMeta, fileAbsolutePath);
    }

    return res.type("html").send(renderMultiFilePage(share, req));
  } catch (error) {
    return next(error);
  }
});

app.get("/d/:id/file/:index", async (req, res, next) => {
  try {
    await cleanupExpiredShares();
    const shares = await readShares();
    const share = shares[req.params.id];

    if (!share || share.assetType !== "files") {
      return res.status(404).send("Link not found or expired.");
    }

    const index = Number.parseInt(req.params.index, 10);
    if (Number.isNaN(index) || index < 0 || index >= share.files.length) {
      return res.status(404).send("File not found.");
    }

    const fileMeta = share.files[index];
    const absolutePath = path.join(ROOT_DIR, fileMeta.relativePath);
    return sendFileAndTrackDownload(res, share, fileMeta, absolutePath);
  } catch (error) {
    return next(error);
  }
});

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "A file exceeded 512 MB." });
    }

    return res.status(400).json({ error: `Upload error: ${error.message}` });
  }

  console.error("Unhandled error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return res.status(500).json({ error: "Internal server error." });
});

async function bootstrap() {
  await ensureEnvironment();
  await cleanupExpiredShares();

  const timer = setInterval(() => {
    cleanupExpiredShares().catch((error) => {
      console.error("Background cleanup error:", error);
    });
  }, CLEANUP_INTERVAL_MS);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  const port = Number.parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.log(`File share server started on http://localhost:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Server failed to start:", error);
  process.exit(1);
});

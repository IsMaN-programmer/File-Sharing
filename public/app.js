const uploadForm = document.getElementById("uploadForm");
const filesInput = document.getElementById("files");
const archiveInput = document.getElementById("archive");
const uploadButton = document.getElementById("uploadButton");
const formStatus = document.getElementById("formStatus");
const resultBox = document.getElementById("result");
const sharesList = document.getElementById("sharesList");
const sharesEmpty = document.getElementById("sharesEmpty");
const refreshSharesButton = document.getElementById("refreshShares");
const shareTemplate = document.getElementById("shareItemTemplate");
const limitsBox = document.getElementById("limits");
const langToggle = document.getElementById("langToggle");

// Ensure langToggle element exists and is ready
if (!langToggle) {
  console.error("Language toggle button not found");
}

function updateUI() {
  document.getElementById("title").textContent = i18n.t("title");
  document.getElementById("subtitle").textContent = i18n.t("subtitle");
  document.getElementById("uploadHeading").textContent = i18n.t("uploadHeading");
  document.getElementById("filesLabel").textContent = i18n.t("filesLabel");
  document.getElementById("filesHint").textContent = i18n.t("filesHint");
  document.getElementById("modeLabel").textContent = i18n.t("modeLabel");
  document.getElementById("modeOneTime").textContent = i18n.t("modeOneTime");
  document.getElementById("modeOneTimeHint").textContent = i18n.t("modeOneTimeHint");
  document.getElementById("modeSeven").textContent = i18n.t("modeSeven");
  document.getElementById("modeSevenHint").textContent = i18n.t("modeSevenHint");
  document.getElementById("modeHundred").textContent = i18n.t("modeHundred");
  document.getElementById("modeHundredHint").textContent = i18n.t("modeHundredHint");
  document.getElementById("archiveSwitch").textContent = i18n.t("archiveSwitch");
  document.getElementById("uploadButton").textContent = i18n.t("uploadButton");
  document.getElementById("linksHeading").textContent = i18n.t("linksHeading");
  document.getElementById("refreshShares").textContent = i18n.t("refreshButton");
  document.getElementById("sharesEmpty").textContent = i18n.t("noLinks");
  document.documentElement.lang = i18n.getLang();
  
  if (langToggle) {
    langToggle.textContent = i18n.getLang() === "en" ? "RU" : "EN";
  }
  
  loadLimits();
  loadShares();
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 MB";
  }

  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function formatDate(timestamp) {
  if (!timestamp) {
    return i18n.t("afterFirstDownload");
  }

  const locale = i18n.getLang() === "en" ? "en-US" : "ru-RU";
  return new Date(timestamp).toLocaleString(locale);
}

function shortId(id) {
  return id.slice(0, 8);
}

function showResult(share) {
  const modeLabel = share.mode === "one_time" ? i18n.t("modeOneTime") : 
                    share.mode === "seven_days" ? i18n.t("modeSeven") : 
                    i18n.t("modeHundred");

  const details = [
    `${i18n.t("mode")}: ${modeLabel}`,
    `${i18n.t("files")}: ${share.fileCount}`,
    `${i18n.t("expires")}: ${formatDate(share.expiresAt)}`
  ].join("<br />");

  resultBox.innerHTML = `
    <strong>${i18n.t("linkReady")}</strong>
    <a href="${share.downloadUrl}" target="_blank" rel="noopener noreferrer">${share.downloadUrl}</a>
    <p>${details}</p>
    <button type="button" id="copyLatestLink">${i18n.t("copyLink")}</button>
  `;

  resultBox.classList.remove("hidden");

  const copyButton = document.getElementById("copyLatestLink");
  const origText = i18n.t("copyLink");
  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(share.downloadUrl);
      copyButton.textContent = i18n.t("copied");
      setTimeout(() => {
        copyButton.textContent = origText;
      }, 1200);
    } catch {
      copyButton.textContent = i18n.t("copyFailed");
    }
  });
}

function setFormStatus(text, isError = false) {
  formStatus.textContent = text;
  formStatus.style.color = isError ? "#bb3e03" : "#4c5b68";
}

function renderShares(shares) {
  sharesList.innerHTML = "";

  if (!shares.length) {
    sharesEmpty.style.display = "block";
    return;
  }

  sharesEmpty.style.display = "none";

  shares.forEach((share) => {
    const node = shareTemplate.content.firstElementChild.cloneNode(true);
    const title = node.querySelector(".share-title");
    const meta = node.querySelector(".share-meta");
    const copyButton = node.querySelector(".copy-link");
    const deleteButton = node.querySelector(".delete-link");

    const modeLabel = share.mode === "one_time" ? i18n.t("modeOneTime") : 
                      share.mode === "seven_days" ? i18n.t("modeSeven") : 
                      i18n.t("modeHundred");

    title.textContent = `#${shortId(share.id)} • ${share.isArchive ? "ZIP" : i18n.t("files")}`;
    meta.textContent = `${i18n.t("mode")}: ${modeLabel} | ${i18n.t("files")}: ${share.fileCount} | ${i18n.t("downloads")}: ${share.downloadCount} | ${i18n.t("until")}: ${formatDate(share.expiresAt)}`;

    copyButton.textContent = i18n.t("copyButton");
    deleteButton.textContent = i18n.t("deleteButton");

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(share.downloadUrl);
        copyButton.textContent = i18n.t("copied");
        setTimeout(() => {
          copyButton.textContent = i18n.t("copyButton");
        }, 1200);
      } catch {
        copyButton.textContent = i18n.t("copyFailed");
      }
    });

    deleteButton.addEventListener("click", async () => {
      deleteButton.disabled = true;
      try {
        const response = await fetch(`/api/shares/${share.id}`, { method: "DELETE" });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || i18n.t("deleteFailed"));
        }

        await loadShares();
      } catch (error) {
        alert(error.message);
      } finally {
        deleteButton.disabled = false;
      }
    });

    sharesList.appendChild(node);
  });
}

async function loadLimits() {
  try {
    const response = await fetch("/api/limits");
    const body = await response.json();
    limitsBox.innerHTML = `
      <span>${i18n.t("maxFile")}: ${formatBytes(body.maxFileSizeBytes)}</span>
      <span>${i18n.t("maxArchive")}: ${formatBytes(body.maxArchiveSizeBytes)}</span>
    `;
  } catch {
    limitsBox.innerHTML = `<span>${i18n.t("limitsUnavailable")}</span>`;
  }
}

async function loadShares() {
  refreshSharesButton.disabled = true;

  try {
    const response = await fetch("/api/shares");
    const body = await response.json();

    if (!response.ok) {
      throw new Error(body.error || i18n.t("couldNotLoad"));
    }

    renderShares(body.shares || []);
  } catch (error) {
    sharesList.innerHTML = "";
    sharesEmpty.style.display = "block";
    sharesEmpty.textContent = error.message;
  } finally {
    refreshSharesButton.disabled = false;
  }
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const selectedFiles = filesInput.files;
  if (!selectedFiles || !selectedFiles.length) {
    setFormStatus(i18n.t("selectFile"), true);
    return;
  }

  const mode = uploadForm.querySelector("input[name='mode']:checked").value;
  const formData = new FormData();

  Array.from(selectedFiles).forEach((file) => {
    formData.append("files", file);
  });

  formData.append("mode", mode);
  formData.append("archive", archiveInput.checked ? "true" : "false");

  uploadButton.disabled = true;
  setFormStatus(i18n.t("uploading"));

  try {
    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || i18n.t("uploadFailed"));
    }

    setFormStatus(i18n.t("uploadComplete"));
    showResult(body.share);
    uploadForm.reset();
    archiveInput.checked = true;
    await loadShares();
  } catch (error) {
    setFormStatus(error.message, true);
  } finally {
    uploadButton.disabled = false;
  }
});

refreshSharesButton.addEventListener("click", () => {
  loadShares();
});

if (langToggle) {
  langToggle.addEventListener("click", () => {
    const newLang = i18n.getLang() === "en" ? "ru" : "en";
    i18n.setLang(newLang);
    updateUI();
  });
}

updateUI();

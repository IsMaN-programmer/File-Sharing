const translations = {
  en: {
    eyebrow: "WebLancer Share",
    title: "Share Files Fast",
    subtitle: "Upload, pick mode, copy link.",
    maxFile: "Max file",
    maxArchive: "Max archive",
    uploadHeading: "Upload",
    filesLabel: "Files",
    filesHint: "Multi-select supported.",
    modeLabel: "Download mode",
    modeOneTime: "One-time",
    modeOneTimeHint: "Delete after 1 download",
    modeSeven: "7 days",
    modeSevenHint: "Delete after 7 days",
    modeHundred: "100 days",
    modeHundredHint: "Delete after 100 days",
    archiveSwitch: "Auto ZIP selected files",
    uploadButton: "Upload",
    linksHeading: "Links",
    refreshButton: "Refresh",
    noLinks: "No active links.",
    copyButton: "Copy",
    deleteButton: "Delete",
    uploading: "Uploading...",
    selectFile: "Select at least one file.",
    uploadComplete: "Upload complete.",
    uploadFailed: "Upload failed.",
    linkReady: "Link ready",
    copyLink: "Copy link",
    copied: "Copied",
    copyFailed: "Copy failed",
    deleteFailed: "Delete failed",
    mode: "Mode",
    files: "Files",
    expires: "Expires",
    downloads: "Downloads",
    until: "Until",
    afterFirstDownload: "after first download",
    couldNotLoad: "Could not load links",
    limitsUnavailable: "Limits unavailable.",
    done: "Done."
  },
  ru: {
    eyebrow: "WebLancer Share",
    title: "Файлообменик",
    subtitle: "Загрузи, выбери режим, скопируй ссылку.",
    maxFile: "Макс. файл",
    maxArchive: "Макс. архив",
    uploadHeading: "Загрузка",
    filesLabel: "Файлы",
    filesHint: "Поддерживается выбор нескольких файлов.",
    modeLabel: "Режим скачивания",
    modeOneTime: "Одноразовое",
    modeOneTimeHint: "Удаляется после 1 скачивания",
    modeSeven: "7 дней",
    modeSevenHint: "Удаляется через 7 дней",
    modeHundred: "100 дней",
    modeHundredHint: "Удаляется через 100 дней",
    archiveSwitch: "Автоматически объединить файлы в ZIP",
    uploadButton: "Загрузить",
    linksHeading: "Активные ссылки",
    refreshButton: "Обновить",
    noLinks: "Нет активных ссылок.",
    copyButton: "Копировать",
    deleteButton: "Удалить",
    uploading: "Загрузка файлов...",
    selectFile: "Выберите минимум один файл.",
    uploadComplete: "Загрузка завершена.",
    uploadFailed: "Ошибка загрузки.",
    linkReady: "Ссылка готова",
    copyLink: "Копировать ссылку",
    copied: "Скопировано",
    copyFailed: "Ошибка копирования",
    deleteFailed: "Ошибка удаления",
    mode: "Режим",
    files: "Файлов",
    expires: "Срок",
    downloads: "Скачиваний",
    until: "До",
    afterFirstDownload: "после первого скачивания",
    couldNotLoad: "Не удалось загрузить ссылки",
    limitsUnavailable: "Лимиты недоступны.",
    done: "Готово."
  }
};

class I18n {
  constructor() {
    this.currentLang = localStorage.getItem("lang") || "en";
  }

  t(key) {
    return (translations[this.currentLang] && translations[this.currentLang][key]) || 
           translations.en[key] || 
           key;
  }

  setLang(lang) {
    if (translations[lang]) {
      this.currentLang = lang;
      localStorage.setItem("lang", lang);
      return true;
    }
    return false;
  }

  getLang() {
    return this.currentLang;
  }
}

const i18n = new I18n();

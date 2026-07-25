type TransferFileItem = {
  getAsFile(): File | null;
  kind: string;
};

type TransferFileSource = {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<TransferFileItem> | null;
};

/**
 * Clipboard implementations vary: screenshots can be exposed through a
 * FileList, file-kind items, or both. Prefer direct files so the same image
 * is not queued twice; ordinary text paste stays with the composer.
 */
export function getTransferFiles(source: TransferFileSource | null | undefined): File[] {
  const directFiles = Array.from(source?.files ?? []);

  if (directFiles.length > 0) {
    return directFiles;
  }

  const files: File[] = [];

  for (const item of Array.from(source?.items ?? [])) {
    if (item.kind !== 'file') {
      continue;
    }

    const file = item.getAsFile();

    if (file) {
      files.push(file);
    }
  }

  return files;
}

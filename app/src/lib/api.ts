import { invoke } from "@tauri-apps/api/core";
import type {
  BatchPdfOutput,
  FolderListing,
  LaunchTarget,
  PdfFilePayload,
  PdfResumeInfo,
  SaveResult,
} from "./types";

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

export async function getLaunchTarget(): Promise<LaunchTarget> {
  return invoke<LaunchTarget>("get_launch_target");
}

export async function listDrives(): Promise<string[]> {
  return invoke<string[]>("list_drives");
}

export async function listPdfFolder(path: string): Promise<FolderListing> {
  return invoke<FolderListing>("list_pdf_folder", { path });
}

export async function readPdfBase64(path: string): Promise<PdfFilePayload> {
  return invoke<PdfFilePayload>("read_pdf_base64", { path });
}

export async function suggestSavePath(originalPath: string, suffix: string): Promise<string> {
  return invoke<string>("suggest_save_path", { originalPath, suffix });
}

export async function writePdfBase64(
  path: string,
  base64Data: string,
  allowOverwrite: boolean
): Promise<SaveResult> {
  return invoke<SaveResult>("write_pdf_base64", {
    path,
    base64Data,
    allowOverwrite,
  });
}

export async function writeMultiplePdfsBase64(
  files: BatchPdfOutput[],
  allowOverwrite: boolean
): Promise<string[]> {
  return invoke<string[]>("write_multiple_pdfs_base64", {
    files,
    allowOverwrite,
  });
}

export async function savePdfResume(
  filePath: string,
  page: number,
  zoom: number
): Promise<void> {
  return invoke<void>("save_pdf_resume", { filePath, page, zoom });
}

export async function getPdfResume(filePath: string): Promise<PdfResumeInfo | null> {
  return invoke<PdfResumeInfo | null>("get_pdf_resume", { filePath });
}

export async function getThemeSetting(): Promise<string> {
  return invoke<string>("get_theme_setting");
}

export async function getGuifThemePreset(): Promise<string> {
  return invoke<string>("get_guif_theme_preset");
}

export async function saveThemeSetting(theme: string): Promise<string> {
  return invoke<string>("save_theme_setting", { theme });
}

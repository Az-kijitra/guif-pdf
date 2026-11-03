<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    base64ToUint8Array,
    formatBytes,
    getGuifThemePreset,
    getLaunchTarget,
    getPdfResume,
    getThemeSetting,
    listDrives,
    listPdfFolder,
    readPdfBase64,
    savePdfResume,
    saveThemeSetting,
    suggestSavePath,
    uint8ArrayToBase64,
    writeMultiplePdfsBase64,
    writePdfBase64,
  } from "$lib/api";
  import MenuBar from "$lib/components/MenuBar.svelte";
  import MergeModal from "$lib/components/MergeModal.svelte";
  import PageOperationBar from "$lib/components/PageOperationBar.svelte";
  import PdfPageCanvas from "$lib/components/PdfPageCanvas.svelte";
  import SaveExtractModal from "$lib/components/SaveExtractModal.svelte";
  import ShortcutHelpModal from "$lib/components/ShortcutHelpModal.svelte";
  import SidebarPanel from "$lib/components/SidebarPanel.svelte";
  import SplitModal from "$lib/components/SplitModal.svelte";
  import ThumbnailItem from "$lib/components/ThumbnailItem.svelte";
  import TopToolbar from "$lib/components/TopToolbar.svelte";
  import { formatPageSet, parsePageSpec } from "$lib/pageRangeParser";
  import {
    buildPdfFromVirtualPages,
    buildSplitPdfFiles,
    getPdfPageCountFromBase64,
    mergePdfQueue,
  } from "$lib/pdfEngine";
  import type {
    FolderEntry,
    MergeQueueItem,
    OutlineItem,
    PdfAnnotation,
    SidebarTab,
    SplitGroupPreview,
    ToolMode,
    ViewLayoutMode,
    VirtualPage,
  } from "$lib/types";

  // PDF.js library reference (loaded on mount in browser)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdfjsLib: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdfDoc = $state.raw<any>(null);
  let sourcePdfBytes = $state.raw<Uint8Array | null>(null);

  // Active document metadata
  let activeFilePath = $state("");
  let activeFileName = $state("");
  let activeFileSize = $state(0);
  let isModified = $state(false);

  // Virtual Pages & Annotations state
  let virtualPages = $state<VirtualPage[]>([]);
  let annotationsByPageId = $state<Record<string, PdfAnnotation[]>>({});
  let selectedAnnotationId = $state<string | null>(null);

  // Undo / Redo Snapshot Stack
  interface HistorySnapshot {
    virtualPages: VirtualPage[];
    annotationsByPageId: Record<string, PdfAnnotation[]>;
  }
  let undoStack = $state<HistorySnapshot[]>([]);
  let redoStack = $state<HistorySnapshot[]>([]);

  // View & Navigation state (Toolbars are collapsed by default for distraction-free viewing!)
  let sidebarOpen = $state(true);
  let pageBarOpen = $state(false);
  let annotationBarOpen = $state(false);
  let sidebarTab = $state<SidebarTab>("pages");
  let layoutMode = $state<ViewLayoutMode>("continuous");
  let currentPage = $state(1);
  let zoomScale = $state(1.2);
  let mainViewportEl: HTMLElement | undefined = $state();
  let isProgrammaticScroll = false;

  // Dual Page Selection (Visual Checkboxes <-> Page Number Spec Input)
  let selectedPagesList = $state<number[]>([]);
  const selectedPagesSet = $derived(new Set(selectedPagesList));
  let lastClickedPageNum = $state<number | null>(null);
  let pageSpecText = $state("");
  let pageSpecError = $state<string | null>(null);

  // Annotation Tool state
  let toolMode = $state<ToolMode>("select");
  let activeColor = $state("#facc15");
  let activeStrokeWidth = $state(2.5);
  let activeFontSize = $state(14);
  let activeBgFill = $state(true);

  // Search state
  let searchOpen = $state(false);
  let searchQuery = $state("");
  let pageTextsCache = $state<Record<number, string>>({});

  // Outline / Bookmarks
  let outlineItems = $state<OutlineItem[]>([]);

  // Folder Browser state
  let drives = $state<string[]>([]);
  let currentDir = $state("");
  let parentDir = $state<string | null>(null);
  let folderEntries = $state<FolderEntry[]>([]);

  // Modals state
  let saveExtractModalMode = $state<"save" | "extract" | null>(null);
  let modalSuggestedPath = $state("");
  let splitModalOpen = $state(false);
  let mergeModalOpen = $state(false);
  let mergeQueue = $state<MergeQueueItem[]>([]);
  let mergeSuggestedPath = $state("");
  let overwriteConfirmOpen = $state(false);
  let helpModalOpen = $state(false);
  let isBusy = $state(false);

  // Theme & Status Notification
  let themeSetting = $state("guif");
  let statusMessage = $state("準備完了");
  let statusKind = $state<"info" | "success" | "error">("info");

  function notify(msg: string, kind: "info" | "success" | "error" = "info") {
    statusMessage = msg;
    statusKind = kind;
  }

  const baseFileStem = $derived.by(() => {
    if (!activeFileName) return "document";
    return activeFileName.replace(/\.pdf$/i, "") || "document";
  });

  const searchHitPages = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const hits: number[] = [];
    virtualPages.forEach((vp, idx) => {
      const txt = pageTextsCache[vp.sourcePageIndex] ?? "";
      if (txt.includes(q)) {
        hits.push(idx + 1);
      }
    });
    return hits;
  });

  onMount(async () => {
    // 1. Initialize PDF.js with bundled worker
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      import.meta.url
    ).toString();
    pdfjsLib = pdfjs;

    // 2. Load Theme (guif config.toml aligned)
    try {
      const savedTheme = await getThemeSetting();
      themeSetting = savedTheme;
      const resolved =
        savedTheme === "guif" ? await getGuifThemePreset() : savedTheme;
      document.documentElement.dataset.theme = resolved;
    } catch {
      document.documentElement.dataset.theme = "nord";
    }

    // 3. Load Drives & Launch Target from CLI (guif integration)
    try {
      drives = await listDrives();
      const target = await getLaunchTarget();
      if (target.initial_dir) {
        await navigateFolder(target.initial_dir);
      }
      if (target.initial_file) {
        await openPdfFromDisk(target.initial_file);
      } else {
        sidebarTab = "folder";
        notify("左パネルの「フォルダー」からPDFファイルを選択してください。", "info");
      }
    } catch (e) {
      notify(`初期化エラー: ${e}`, "error");
    }
  });

  async function handleChangeTheme(newTheme: string) {
    themeSetting = newTheme;
    try {
      const resolved = await saveThemeSetting(newTheme);
      document.documentElement.dataset.theme = resolved;
      notify(`テーマを「${newTheme}」に変更しました。`, "info");
    } catch {
      document.documentElement.dataset.theme =
        newTheme === "guif" ? "nord" : newTheme;
    }
  }

  async function navigateFolder(dirPath: string) {
    try {
      const listing = await listPdfFolder(dirPath);
      currentDir = listing.current_dir;
      parentDir = listing.parent_dir;
      folderEntries = listing.entries;
      if (listing.error) {
        notify(listing.error, "error");
      }
    } catch (e) {
      notify(`フォルダー移動エラー: ${e}`, "error");
    }
  }

  async function openPdfFromDisk(filePath: string) {
    try {
      isBusy = true;
      notify(`読み込み中: ${filePath} ...`, "info");
      const payload = await readPdfBase64(filePath);
      const bytes = base64ToUint8Array(payload.base64_data);
      await loadPdfBytesIntoWorkspace(
        bytes,
        payload.file_path,
        payload.file_name,
        payload.size_bytes
      );

      if (payload.dir_path && payload.dir_path !== currentDir) {
        await navigateFolder(payload.dir_path);
      }

      // Restore resume page/zoom if available
      const resume = await getPdfResume(payload.file_path);
      if (resume) {
        if (resume.zoom >= 0.4 && resume.zoom <= 3.5) {
          zoomScale = resume.zoom;
        }
        if (resume.page >= 1 && resume.page <= virtualPages.length) {
          await tick();
          goToPage(resume.page);
        }
      }
      sidebarTab = "pages";
      notify(
        `「${payload.file_name}」を開きました（全 ${virtualPages.length} ページ）`,
        "success"
      );
    } catch (e) {
      notify(`PDFを開けませんでした: ${e}`, "error");
    } finally {
      isBusy = false;
    }
  }

  async function loadPdfBytesIntoWorkspace(
    bytes: Uint8Array,
    filePath: string,
    fileName: string,
    sizeBytes: number
  ) {
    if (!pdfjsLib) return;
    const bytesForPdfLib = new Uint8Array(bytes);
    const bytesForPdfJs = new Uint8Array(bytes);

    const loadingTask = pdfjsLib.getDocument({
      data: bytesForPdfJs,
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      useSystemFonts: true,
    });
    const doc = await loadingTask.promise;

    const pages: VirtualPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const vp = p.getViewport({ scale: 1, rotation: 0 });
      pages.push({
        id: `vp-${Date.now()}-${i}`,
        sourcePageIndex: i - 1,
        originalPageNumber: i,
        baseRotation: p.rotate || 0,
        addedRotation: 0,
        widthPt: vp.width,
        heightPt: vp.height,
      });
    }

    sourcePdfBytes = bytesForPdfLib;
    pdfDoc = doc;
    activeFilePath = filePath;
    activeFileName = fileName;
    activeFileSize = sizeBytes;
    virtualPages = pages;
    annotationsByPageId = {};
    selectedAnnotationId = null;
    undoStack = [];
    redoStack = [];
    selectedPagesList = [];
    pageSpecText = "";
    pageSpecError = null;
    currentPage = 1;
    isModified = false;
    pageTextsCache = {};

    void extractAllSearchTextsAndOutline(doc);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function extractAllSearchTextsAndOutline(doc: any) {
    try {
      const outline = await doc.getOutline();
      if (Array.isArray(outline)) {
        const items: OutlineItem[] = [];
        for (const node of outline) {
          const pageNum = await resolveOutlineDestPage(doc, node.dest);
          const children: OutlineItem[] = [];
          if (Array.isArray(node.items)) {
            for (const child of node.items) {
              const cp = await resolveOutlineDestPage(doc, child.dest);
              children.push({
                title: child.title || "無題",
                pageNumber: cp,
                children: [],
              });
            }
          }
          items.push({
            title: node.title || "無題",
            pageNumber: pageNum,
            children,
          });
        }
        outlineItems = items;
      } else {
        outlineItems = [];
      }
    } catch {
      outlineItems = [];
    }

    const cache: Record<number, string> = {};
    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const p = await doc.getPage(i);
        const tc = await p.getTextContent();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const joined = tc.items.map((it: any) => it.str || "").join(" ").toLowerCase();
        cache[i - 1] = joined;
      } catch {
        // ignore
      }
    }
    pageTextsCache = cache;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function resolveOutlineDestPage(doc: any, dest: any): Promise<number | null> {
    try {
      if (!dest) return null;
      const explicitDest =
        typeof dest === "string" ? await doc.getDestination(dest) : dest;
      if (Array.isArray(explicitDest) && explicitDest[0]) {
        const pageIndex = await doc.getPageIndex(explicitDest[0]);
        return pageIndex + 1;
      }
    } catch {
      // ignore
    }
    return null;
  }

  // ----------------------------------------------------
  // Undo / Redo Snapshot Management
  // ----------------------------------------------------
  function cloneSnapshot(): HistorySnapshot {
    return {
      virtualPages: virtualPages.map((vp) => ({ ...vp })),
      annotationsByPageId: JSON.parse(JSON.stringify(annotationsByPageId)),
    };
  }

  function pushUndoSnapshot() {
    undoStack = [...undoStack.slice(-39), cloneSnapshot()];
    redoStack = [];
    isModified = true;
  }

  function handleUndo() {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    redoStack = [...redoStack, cloneSnapshot()];
    undoStack = undoStack.slice(0, -1);
    virtualPages = prev.virtualPages;
    annotationsByPageId = prev.annotationsByPageId;
    if (currentPage > virtualPages.length) {
      currentPage = Math.max(1, virtualPages.length);
    }
    syncSelectionAfterPageCountChange();
    notify("操作を元に戻しました (Undo)", "info");
  }

  function handleRedo() {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    undoStack = [...undoStack, cloneSnapshot()];
    redoStack = redoStack.slice(0, -1);
    virtualPages = next.virtualPages;
    annotationsByPageId = next.annotationsByPageId;
    if (currentPage > virtualPages.length) {
      currentPage = Math.max(1, virtualPages.length);
    }
    syncSelectionAfterPageCountChange();
    notify("操作をやり直しました (Redo)", "info");
  }

  function syncSelectionAfterPageCountChange() {
    const valid = selectedPagesList.filter((p) => p >= 1 && p <= virtualPages.length);
    selectedPagesList = valid;
    pageSpecText = formatPageSet(valid);
    pageSpecError = null;
  }

  // ----------------------------------------------------
  // Page Navigation & Zoom
  // ----------------------------------------------------
  function goToPage(pageNum: number) {
    if (virtualPages.length === 0) return;
    const clamped = Math.max(1, Math.min(virtualPages.length, pageNum));
    currentPage = clamped;

    if (layoutMode === "continuous" && mainViewportEl) {
      const targetEl = mainViewportEl.querySelector(
        `[data-page-number="${clamped}"]`
      );
      if (targetEl) {
        isProgrammaticScroll = true;
        targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
        setTimeout(() => {
          isProgrammaticScroll = false;
        }, 450);
      }
    } else if (layoutMode === "grid") {
      layoutMode = "continuous";
      void tick().then(() => goToPage(clamped));
    }

    if (activeFilePath) {
      void savePdfResume(activeFilePath, clamped, zoomScale);
    }
  }

  function handlePageVisible(pageNum: number) {
    if (isProgrammaticScroll) return;
    if (currentPage !== pageNum) {
      currentPage = pageNum;
      if (activeFilePath) {
        void savePdfResume(activeFilePath, pageNum, zoomScale);
      }
    }
  }

  function handleChangeZoom(newScale: number) {
    const clamped = Math.max(0.35, Math.min(3.2, Number(newScale.toFixed(2))));
    zoomScale = clamped;
    if (activeFilePath) {
      void savePdfResume(activeFilePath, currentPage, clamped);
    }
  }

  function handleFitWidth() {
    if (!mainViewportEl || virtualPages.length === 0) return;
    const vp = virtualPages[currentPage - 1] ?? virtualPages[0];
    const rot = (((vp.baseRotation + vp.addedRotation) % 360) + 360) % 360;
    const pageW = rot === 90 || rot === 270 ? vp.heightPt : vp.widthPt;
    const availW = Math.max(320, mainViewportEl.clientWidth - 56);
    handleChangeZoom(availW / Math.max(1, pageW));
  }

  function handleFitPage() {
    if (!mainViewportEl || virtualPages.length === 0) return;
    const vp = virtualPages[currentPage - 1] ?? virtualPages[0];
    const rot = (((vp.baseRotation + vp.addedRotation) % 360) + 360) % 360;
    const pageW = rot === 90 || rot === 270 ? vp.heightPt : vp.widthPt;
    const pageH = rot === 90 || rot === 270 ? vp.widthPt : vp.heightPt;
    const availW = Math.max(320, mainViewportEl.clientWidth - 56);
    const availH = Math.max(300, mainViewportEl.clientHeight - 72);
    handleChangeZoom(Math.min(availW / Math.max(1, pageW), availH / Math.max(1, pageH)));
  }

  // ----------------------------------------------------
  // Dual Page Selection (Visual Checkboxes <-> Page Spec Input)
  // ----------------------------------------------------
  function handleToggleSelectPage(pageNum: number, shiftKey: boolean) {
    const nextSet = new Set(selectedPagesList);

    if (shiftKey && lastClickedPageNum !== null) {
      const start = Math.min(lastClickedPageNum, pageNum);
      const end = Math.max(lastClickedPageNum, pageNum);
      const shouldSelect = !nextSet.has(pageNum);
      for (let p = start; p <= end; p++) {
        if (shouldSelect) nextSet.add(p);
        else nextSet.delete(p);
      }
    } else {
      if (nextSet.has(pageNum)) {
        nextSet.delete(pageNum);
      } else {
        nextSet.add(pageNum);
      }
    }

    lastClickedPageNum = pageNum;
    const sorted = Array.from(nextSet).sort((a, b) => a - b);
    selectedPagesList = sorted;
    pageSpecText = formatPageSet(sorted);
    pageSpecError = null;
  }

  function handlePageSpecInputChange(rawVal: string) {
    pageSpecText = rawVal;
    if (!rawVal.trim()) {
      selectedPagesList = [];
      pageSpecError = null;
      return;
    }
    const parsed = parsePageSpec(rawVal, virtualPages.length);
    if (parsed.error) {
      pageSpecError = parsed.error;
    } else {
      pageSpecError = null;
      selectedPagesList = parsed.pages;
    }
  }

  function handleSelectPreset(
    preset:
      | "all"
      | "none"
      | "invert"
      | "odd"
      | "even"
      | "from_current"
      | "to_current"
  ) {
    const n = virtualPages.length;
    if (n === 0) return;

    let next: number[] = [];
    if (preset === "all") {
      for (let i = 1; i <= n; i++) next.push(i);
    } else if (preset === "none") {
      next = [];
    } else if (preset === "invert") {
      for (let i = 1; i <= n; i++) {
        if (!selectedPagesSet.has(i)) next.push(i);
      }
    } else if (preset === "odd") {
      for (let i = 1; i <= n; i += 2) next.push(i);
    } else if (preset === "even") {
      for (let i = 2; i <= n; i += 2) next.push(i);
    } else if (preset === "from_current") {
      for (let i = currentPage; i <= n; i++) next.push(i);
    } else if (preset === "to_current") {
      for (let i = 1; i <= currentPage; i++) next.push(i);
    }

    selectedPagesList = next;
    pageSpecText = formatPageSet(next);
    pageSpecError = null;
  }

  // ----------------------------------------------------
  // Page Manipulation Operations (Rotate, Reorder, Delete)
  // ----------------------------------------------------
  function handleRotateSinglePage(pageNum: number, delta: number) {
    const idx = pageNum - 1;
    if (idx < 0 || idx >= virtualPages.length) return;
    pushUndoSnapshot();
    virtualPages = virtualPages.map((vp, i) =>
      i === idx
        ? { ...vp, addedRotation: (((vp.addedRotation + delta) % 360) + 360) % 360 }
        : vp
    );
    notify(`ページ ${pageNum} を ${delta > 0 ? `+${delta}` : delta}° 回転しました`, "info");
  }

  function handleRotateSelectedOrCurrent(delta: number) {
    if (virtualPages.length === 0) return;
    const targets =
      selectedPagesList.length > 0 ? selectedPagesList : [currentPage];
    const targetSet = new Set(targets);
    pushUndoSnapshot();
    virtualPages = virtualPages.map((vp, idx) =>
      targetSet.has(idx + 1)
        ? { ...vp, addedRotation: (((vp.addedRotation + delta) % 360) + 360) % 360 }
        : vp
    );
    notify(
      `${targets.length} ページを ${delta > 0 ? `+${delta}` : delta}° 回転しました`,
      "info"
    );
  }

  function handleMovePage(pageNum: number, dir: -1 | 1) {
    const idx = pageNum - 1;
    const targetIdx = idx + dir;
    if (
      idx < 0 ||
      idx >= virtualPages.length ||
      targetIdx < 0 ||
      targetIdx >= virtualPages.length
    ) {
      return;
    }
    pushUndoSnapshot();
    const copy = [...virtualPages];
    const [moved] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, moved);
    virtualPages = copy;
    currentPage = targetIdx + 1;
    notify(`ページ ${pageNum} を P.${targetIdx + 1} へ移動しました`, "info");
  }

  function handleDeleteSinglePage(pageNum: number) {
    if (virtualPages.length <= 1) {
      notify("最後の1ページは削除できません。", "error");
      return;
    }
    pushUndoSnapshot();
    virtualPages = virtualPages.filter((_, idx) => idx + 1 !== pageNum);
    if (currentPage > virtualPages.length) {
      currentPage = virtualPages.length;
    }
    syncSelectionAfterPageCountChange();
    notify(`ページ ${pageNum} を削除しました（Ctrl+Z で元に戻せます）`, "info");
  }

  function handleDeleteSelectedPages() {
    if (virtualPages.length === 0) return;
    const targets =
      selectedPagesList.length > 0 ? selectedPagesList : [currentPage];
    if (targets.length >= virtualPages.length) {
      notify(
        "すべてのページを削除することはできません。少なくとも1ページ残してください。",
        "error"
      );
      return;
    }
    const delSet = new Set(targets);
    pushUndoSnapshot();
    virtualPages = virtualPages.filter((_, idx) => !delSet.has(idx + 1));
    selectedPagesList = [];
    pageSpecText = "";
    pageSpecError = null;
    if (currentPage > virtualPages.length) {
      currentPage = Math.max(1, virtualPages.length);
    }
    notify(
      `${targets.length} ページを削除しました（Ctrl+Z で元に戻せます / 別名保存で確定）`,
      "info"
    );
  }

  // ----------------------------------------------------
  // Annotations Management
  // ----------------------------------------------------
  function handleAddAnnotation(ann: Omit<PdfAnnotation, "id" | "createdAt">) {
    pushUndoSnapshot();
    const newAnn: PdfAnnotation = {
      ...ann,
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };
    const existing = annotationsByPageId[ann.pageId] ?? [];
    annotationsByPageId = {
      ...annotationsByPageId,
      [ann.pageId]: [...existing, newAnn],
    };
    selectedAnnotationId = newAnn.id;
  }

  function handleUpdateAnnotation(
    pageId: string,
    annId: string,
    patch: Partial<PdfAnnotation>
  ) {
    const list = annotationsByPageId[pageId];
    if (!list) return;
    isModified = true;
    annotationsByPageId = {
      ...annotationsByPageId,
      [pageId]: list.map((a) => (a.id === annId ? { ...a, ...patch } : a)),
    };
  }

  function handleDeleteAnnotation(pageId: string, annId: string) {
    const list = annotationsByPageId[pageId];
    if (!list) return;
    pushUndoSnapshot();
    annotationsByPageId = {
      ...annotationsByPageId,
      [pageId]: list.filter((a) => a.id !== annId),
    };
    if (selectedAnnotationId === annId) {
      selectedAnnotationId = null;
    }
    notify("注釈を削除しました", "info");
  }

  function handleClearAllAnnotations() {
    pushUndoSnapshot();
    annotationsByPageId = {};
    selectedAnnotationId = null;
    notify("すべての注釈を消去しました（Ctrl+Z で元に戻せます）", "info");
  }

  // ----------------------------------------------------
  // Save, Extract, Split, and Merge Execution
  // ----------------------------------------------------
  async function openSaveOrExtractModal(mode: "save" | "extract") {
    if (!sourcePdfBytes || virtualPages.length === 0) return;
    const suffix = mode === "save" ? "_edited" : "_extracted";
    try {
      modalSuggestedPath = await suggestSavePath(
        activeFilePath || `${currentDir}\\document.pdf`,
        suffix
      );
    } catch {
      modalSuggestedPath = `${currentDir}\\${baseFileStem}${suffix}.pdf`;
    }
    saveExtractModalMode = mode;
  }

  async function executeSaveSingle(opts: {
    outputPath: string;
    pageNumbers: number[];
    includeAnnotations: boolean;
    allowOverwrite: boolean;
    openAfterSave: boolean;
  }) {
    if (!sourcePdfBytes) return;
    isBusy = true;
    try {
      const targetVirtualPages: VirtualPage[] = [];
      for (const pNum of opts.pageNumbers) {
        const vp = virtualPages[pNum - 1];
        if (vp) targetVirtualPages.push(vp);
      }

      const outBytes = await buildPdfFromVirtualPages(
        sourcePdfBytes,
        targetVirtualPages,
        annotationsByPageId,
        opts.includeAnnotations
      );
      const base64Data = uint8ArrayToBase64(outBytes);
      const res = await writePdfBase64(
        opts.outputPath,
        base64Data,
        opts.allowOverwrite
      );

      saveExtractModalMode = null;
      if (currentDir) {
        await navigateFolder(currentDir);
      }
      if (opts.pageNumbers.length === virtualPages.length) {
        isModified = false;
      }
      notify(
        `保存完了: ${res.saved_path} (${targetVirtualPages.length} ページ, ${formatBytes(res.size_bytes)})`,
        "success"
      );

      if (opts.openAfterSave) {
        await openPdfFromDisk(res.saved_path);
      }
    } catch (e) {
      notify(`保存エラー: ${e}`, "error");
    } finally {
      isBusy = false;
    }
  }

  async function executeExtractIndividual(opts: {
    outputDir: string;
    basePrefix: string;
    pageNumbers: number[];
    includeAnnotations: boolean;
    allowOverwrite: boolean;
  }) {
    if (!sourcePdfBytes) return;
    isBusy = true;
    try {
      const cleanDir = opts.outputDir.replace(/[\\/]+$/, "");
      const sep = cleanDir.includes("/") ? "/" : "\\";
      const batch: Array<{ path: string; base64_data: string }> = [];

      for (const pNum of opts.pageNumbers) {
        const vp = virtualPages[pNum - 1];
        if (!vp) continue;
        const pdfBytes = await buildPdfFromVirtualPages(
          sourcePdfBytes,
          [vp],
          annotationsByPageId,
          opts.includeAnnotations
        );
        const padded = String(pNum).padStart(3, "0");
        batch.push({
          path: `${cleanDir}${sep}${opts.basePrefix}_p${padded}.pdf`,
          base64_data: uint8ArrayToBase64(pdfBytes),
        });
      }

      const saved = await writeMultiplePdfsBase64(batch, opts.allowOverwrite);
      saveExtractModalMode = null;
      if (currentDir) {
        await navigateFolder(currentDir);
      }
      notify(`個別ページ抽出完了: ${saved.length} 個のPDFファイルを保存しました`, "success");
    } catch (e) {
      notify(`個別抽出エラー: ${e}`, "error");
    } finally {
      isBusy = false;
    }
  }

  async function executeOverwriteOriginal() {
    if (!sourcePdfBytes || !activeFilePath) return;
    isBusy = true;
    try {
      const outBytes = await buildPdfFromVirtualPages(
        sourcePdfBytes,
        virtualPages,
        annotationsByPageId,
        true
      );
      const base64Data = uint8ArrayToBase64(outBytes);
      const res = await writePdfBase64(activeFilePath, base64Data, true);
      overwriteConfirmOpen = false;
      isModified = false;
      if (currentDir) {
        await navigateFolder(currentDir);
      }
      notify(
        `元ファイルを上書き保存しました: ${res.saved_path} (${formatBytes(res.size_bytes)})`,
        "success"
      );
    } catch (e) {
      notify(`上書き保存エラー: ${e}`, "error");
    } finally {
      isBusy = false;
    }
  }

  async function executeSplit(opts: {
    groups: SplitGroupPreview[];
    outputDir: string;
    includeAnnotations: boolean;
    allowOverwrite: boolean;
  }) {
    if (!sourcePdfBytes) return;
    isBusy = true;
    try {
      const batch = await buildSplitPdfFiles(
        sourcePdfBytes,
        virtualPages,
        annotationsByPageId,
        opts.groups,
        opts.outputDir,
        opts.includeAnnotations
      );
      const saved = await writeMultiplePdfsBase64(batch, opts.allowOverwrite);
      splitModalOpen = false;
      if (currentDir) {
        await navigateFolder(currentDir);
      }
      notify(
        `PDF分割完了: ${saved.length} 個のPDFファイルを作成しました`,
        "success"
      );
    } catch (e) {
      notify(`分割エラー: ${e}`, "error");
    } finally {
      isBusy = false;
    }
  }

  async function openMergeDialog() {
    if (mergeQueue.length === 0 && sourcePdfBytes && activeFilePath) {
      try {
        const currentEditedBytes = await buildPdfFromVirtualPages(
          sourcePdfBytes,
          virtualPages,
          annotationsByPageId,
          true
        );
        mergeQueue = [
          {
            id: `mq-${Date.now()}-1`,
            filePath: activeFilePath,
            fileName: activeFileName,
            sizeBytes: currentEditedBytes.length,
            totalPages: virtualPages.length,
            pageSpec: pageSpecText.trim() || "all",
            addedRotation: 0,
            base64Data: uint8ArrayToBase64(currentEditedBytes),
          },
        ];
      } catch {
        // ignore
      }
    }
    try {
      mergeSuggestedPath = await suggestSavePath(
        activeFilePath || `${currentDir}\\document.pdf`,
        "_merged"
      );
    } catch {
      mergeSuggestedPath = `${currentDir}\\${baseFileStem}_merged.pdf`;
    }
    mergeModalOpen = true;
  }

  async function addFileToMergeQueue(filePath: string) {
    try {
      isBusy = true;
      const payload = await readPdfBase64(filePath);
      const totalPages = await getPdfPageCountFromBase64(payload.base64_data);
      const newItem: MergeQueueItem = {
        id: `mq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        filePath: payload.file_path,
        fileName: payload.file_name,
        sizeBytes: payload.size_bytes,
        totalPages,
        pageSpec: "all",
        addedRotation: 0,
        base64Data: payload.base64_data,
      };
      mergeQueue = [...mergeQueue, newItem];
      if (!mergeModalOpen) {
        await openMergeDialog();
      }
      notify(`「${payload.file_name}」(${totalPages}P) を結合リストに追加しました`, "info");
    } catch (e) {
      notify(`結合ファイルの追加エラー: ${e}`, "error");
    } finally {
      isBusy = false;
    }
  }

  async function executeMerge(opts: {
    outputPath: string;
    allowOverwrite: boolean;
    openAfterMerge: boolean;
  }) {
    isBusy = true;
    try {
      const mergedBytes = await mergePdfQueue(mergeQueue);
      const base64Data = uint8ArrayToBase64(mergedBytes);
      const res = await writePdfBase64(
        opts.outputPath,
        base64Data,
        opts.allowOverwrite
      );
      mergeModalOpen = false;
      if (currentDir) {
        await navigateFolder(currentDir);
      }
      notify(`PDF結合完了: ${res.saved_path} (${formatBytes(res.size_bytes)})`, "success");
      if (opts.openAfterMerge) {
        await openPdfFromDisk(res.saved_path);
      }
    } catch (e) {
      notify(`PDF結合エラー: ${e}`, "error");
    } finally {
      isBusy = false;
    }
  }

  function jumpNextSearchHit(dir: -1 | 1) {
    if (searchHitPages.length === 0) return;
    if (dir === 1) {
      const next = searchHitPages.find((p) => p > currentPage) ?? searchHitPages[0];
      goToPage(next);
    } else {
      const prev =
        [...searchHitPages].reverse().find((p) => p < currentPage) ??
        searchHitPages[searchHitPages.length - 1];
      goToPage(prev);
    }
  }

  // ----------------------------------------------------
  // Global Keyboard Navigation (guif / tuif style)
  // ----------------------------------------------------
  function handleGlobalKeyDown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    const isInputFocused =
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    if (e.key === "F2") {
      e.preventDefault();
      pageBarOpen = !pageBarOpen;
      return;
    }

    if (e.key === "F3") {
      e.preventDefault();
      annotationBarOpen = !annotationBarOpen;
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (e.shiftKey) {
        if (activeFilePath && sourcePdfBytes) overwriteConfirmOpen = true;
      } else {
        void openSaveOrExtractModal("save");
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      searchOpen = !searchOpen;
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      sidebarOpen = !sidebarOpen;
      return;
    }

    if (!isInputFocused && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
      return;
    }

    if (!isInputFocused && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      handleRedo();
      return;
    }

    if (isInputFocused) return;

    if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedAnnotationId) {
        e.preventDefault();
        for (const [pageId, anns] of Object.entries(annotationsByPageId)) {
          if (anns.some((a) => a.id === selectedAnnotationId)) {
            handleDeleteAnnotation(pageId, selectedAnnotationId);
            break;
          }
        }
        return;
      }
    }

    switch (e.key) {
      case "j":
      case "J":
      case "PageDown":
        e.preventDefault();
        goToPage(currentPage + 1);
        break;
      case "k":
      case "K":
      case "PageUp":
        e.preventDefault();
        goToPage(currentPage - 1);
        break;
      case "Home":
        e.preventDefault();
        goToPage(1);
        break;
      case "End":
        e.preventDefault();
        goToPage(virtualPages.length);
        break;
      case " ":
        e.preventDefault();
        if (virtualPages.length > 0) {
          handleToggleSelectPage(currentPage, e.shiftKey);
        }
        break;
      case "r":
        e.preventDefault();
        handleRotateSelectedOrCurrent(90);
        break;
      case "R":
        e.preventDefault();
        handleRotateSelectedOrCurrent(-90);
        break;
      case "v":
      case "V":
        toolMode = "select";
        break;
      case "h":
      case "H":
        toolMode = "highlight";
        break;
      case "t":
      case "T":
        toolMode = "text";
        break;
      case "n":
      case "N":
        toolMode = "sticky";
        break;
      case "b":
      case "B":
        toolMode = "rect";
        break;
      case "a":
      case "A":
        toolMode = "arrow";
        break;
      case "l":
      case "L":
        toolMode = "line";
        break;
      case "p":
      case "P":
        toolMode = "pen";
        break;
      case "w":
      case "W":
        handleFitWidth();
        break;
      case "f":
      case "F":
        handleFitPage();
        break;
      case "?":
        helpModalOpen = !helpModalOpen;
        break;
      case "Escape":
        selectedAnnotationId = null;
        toolMode = "select";
        break;
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeyDown} />

<div class="app-shell">
  <!-- Slim Top Menu Bar (with inline page/zoom controls and collapsible toolbar toggles) -->
  <MenuBar
    fileName={activeFileName}
    {isModified}
    hasPdf={virtualPages.length > 0}
    {sidebarOpen}
    {pageBarOpen}
    {annotationBarOpen}
    {searchOpen}
    {layoutMode}
    {currentPage}
    totalPages={virtualPages.length}
    {zoomScale}
    {toolMode}
    {activeColor}
    canUndo={undoStack.length > 0}
    canRedo={redoStack.length > 0}
    selectedCount={selectedPagesList.length}
    {themeSetting}
    onToggleSidebar={() => (sidebarOpen = !sidebarOpen)}
    onTogglePageBar={() => (pageBarOpen = !pageBarOpen)}
    onToggleAnnotationBar={() => (annotationBarOpen = !annotationBarOpen)}
    onToggleSearch={() => (searchOpen = !searchOpen)}
    onChangeLayout={(m) => (layoutMode = m)}
    onGoToPage={goToPage}
    onChangeZoom={handleChangeZoom}
    onFitWidth={handleFitWidth}
    onFitPage={handleFitPage}
    onChangeTool={(t) => (toolMode = t)}
    onChangeColor={(c) => (activeColor = c)}
    onUndo={handleUndo}
    onRedo={handleRedo}
    onSaveAs={() => openSaveOrExtractModal("save")}
    onSaveOverwrite={() => (overwriteConfirmOpen = true)}
    onOpenExtractModal={() => openSaveOrExtractModal("extract")}
    onOpenSplitModal={() => (splitModalOpen = true)}
    onOpenMergeModal={openMergeDialog}
    onRotateSelectedOrCurrent={handleRotateSelectedOrCurrent}
    onDeleteSelectedPages={handleDeleteSelectedPages}
    onToggleCurrentPageSelect={() => handleToggleSelectPage(currentPage, false)}
    onSelectPreset={handleSelectPreset}
    onClearAllAnnotations={handleClearAllAnnotations}
    onOpenFolderTab={() => {
      sidebarOpen = true;
      sidebarTab = "folder";
    }}
    onChangeTheme={handleChangeTheme}
    onOpenHelp={() => (helpModalOpen = true)}
  />

  <!-- Collapsible Annotation Toolbar & Search Bar (collapsed by default) -->
  <TopToolbar
    hasPdf={virtualPages.length > 0}
    {annotationBarOpen}
    {toolMode}
    {activeColor}
    {activeStrokeWidth}
    {activeFontSize}
    {activeBgFill}
    canUndo={undoStack.length > 0}
    canRedo={redoStack.length > 0}
    {searchOpen}
    {searchQuery}
    {searchHitPages}
    onChangeTool={(t) => (toolMode = t)}
    onChangeColor={(c) => (activeColor = c)}
    onChangeStrokeWidth={(w) => (activeStrokeWidth = w)}
    onChangeFontSize={(s) => (activeFontSize = s)}
    onToggleBgFill={() => (activeBgFill = !activeBgFill)}
    onUndo={handleUndo}
    onRedo={handleRedo}
    onCloseAnnotationBar={() => (annotationBarOpen = false)}
    onToggleSearch={() => (searchOpen = !searchOpen)}
    onSearchQueryChange={(q) => (searchQuery = q)}
    onJumpNextSearchHit={jumpNextSearchHit}
  />

  <!-- Collapsible Page Number Specification & Page Manipulation Bar (collapsed by default) -->
  {#if pageBarOpen}
    <PageOperationBar
      totalPages={virtualPages.length}
      {currentPage}
      selectedCount={selectedPagesList.length}
      isCurrentPageSelected={selectedPagesSet.has(currentPage)}
      {pageSpecText}
      {pageSpecError}
      hasPdf={virtualPages.length > 0}
      onPageSpecInputChange={handlePageSpecInputChange}
      onToggleCurrentPageSelect={() => handleToggleSelectPage(currentPage, false)}
      onSelectPreset={handleSelectPreset}
      onRotateSelectedOrCurrent={handleRotateSelectedOrCurrent}
      onDeleteSelectedPages={handleDeleteSelectedPages}
      onOpenExtractModal={() => openSaveOrExtractModal("extract")}
      onOpenSplitModal={() => (splitModalOpen = true)}
      onOpenMergeModal={openMergeDialog}
      onClosePageBar={() => (pageBarOpen = false)}
    />
  {/if}

  <!-- Workspace Body -->
  <div class="workspace-body">
    {#if sidebarOpen}
      <SidebarPanel
        activeTab={sidebarTab}
        {pdfDoc}
        {virtualPages}
        {currentPage}
        {selectedPagesSet}
        {annotationsByPageId}
        {outlineItems}
        {drives}
        {currentDir}
        {parentDir}
        {folderEntries}
        {activeFilePath}
        onChangeTab={(t) => (sidebarTab = t)}
        onJumpToPage={goToPage}
        onToggleSelectPage={handleToggleSelectPage}
        onRotatePage={handleRotateSinglePage}
        onMovePage={handleMovePage}
        onDeletePage={handleDeleteSinglePage}
        onSelectAnnotation={(pageNum, annId) => {
          goToPage(pageNum);
          selectedAnnotationId = annId;
        }}
        onDeleteAnnotation={handleDeleteAnnotation}
        onClearAllAnnotations={handleClearAllAnnotations}
        onNavigateFolder={navigateFolder}
        onOpenPdfFile={openPdfFromDisk}
        onQuickAddMergePdf={addFileToMergeQueue}
      />
    {/if}

    <!-- Main Viewer Area -->
    <main bind:this={mainViewportEl} class="main-viewer">
      {#if virtualPages.length === 0}
        <div class="empty-viewer-placeholder">
          <span>PDFファイルが選択されていません（左パネルの「フォルダー」またはメニューから開けます）</span>
        </div>
      {:else if layoutMode === "continuous"}
        <div class="continuous-pages-container">
          {#each virtualPages as vp, idx (vp.id)}
            {@const pNum = idx + 1}
            <PdfPageCanvas
              {pdfDoc}
              vPage={vp}
              displayPageNumber={pNum}
              scale={zoomScale}
              isCurrentPage={currentPage === pNum}
              isSelected={selectedPagesSet.has(pNum)}
              {toolMode}
              {activeColor}
              {activeStrokeWidth}
              {activeFontSize}
              {activeBgFill}
              annotations={annotationsByPageId[vp.id] ?? []}
              {selectedAnnotationId}
              {searchQuery}
              onToggleSelectPage={handleToggleSelectPage}
              onRotatePage={handleRotateSinglePage}
              onDeletePage={handleDeleteSinglePage}
              onAddAnnotation={handleAddAnnotation}
              onUpdateAnnotation={(annId, patch) =>
                handleUpdateAnnotation(vp.id, annId, patch)}
              onDeleteAnnotation={(annId) => handleDeleteAnnotation(vp.id, annId)}
              onSelectAnnotation={(id) => (selectedAnnotationId = id)}
              onPageVisible={handlePageVisible}
            />
          {/each}
        </div>
      {:else if layoutMode === "single"}
        {@const singleVp = virtualPages[currentPage - 1]}
        {#if singleVp}
          <div class="single-page-container">
            <PdfPageCanvas
              {pdfDoc}
              vPage={singleVp}
              displayPageNumber={currentPage}
              scale={zoomScale}
              isCurrentPage={true}
              isSelected={selectedPagesSet.has(currentPage)}
              {toolMode}
              {activeColor}
              {activeStrokeWidth}
              {activeFontSize}
              {activeBgFill}
              annotations={annotationsByPageId[singleVp.id] ?? []}
              {selectedAnnotationId}
              {searchQuery}
              onToggleSelectPage={handleToggleSelectPage}
              onRotatePage={handleRotateSinglePage}
              onDeletePage={handleDeleteSinglePage}
              onAddAnnotation={handleAddAnnotation}
              onUpdateAnnotation={(annId, patch) =>
                handleUpdateAnnotation(singleVp.id, annId, patch)}
              onDeleteAnnotation={(annId) =>
                handleDeleteAnnotation(singleVp.id, annId)}
              onSelectAnnotation={(id) => (selectedAnnotationId = id)}
            />
          </div>
        {/if}
      {:else if layoutMode === "grid"}
        <div class="grid-overview-container">
          {#each virtualPages as vp, idx (vp.id)}
            {@const pNum = idx + 1}
            <ThumbnailItem
              {pdfDoc}
              vPage={vp}
              displayPageNumber={pNum}
              isCurrent={currentPage === pNum}
              isSelected={selectedPagesSet.has(pNum)}
              annotationCount={(annotationsByPageId[vp.id] ?? []).length}
              thumbWidth={190}
              onJumpToPage={goToPage}
              onToggleSelect={handleToggleSelectPage}
              onRotatePage={handleRotateSinglePage}
              onMovePage={handleMovePage}
              onDeletePage={handleDeleteSinglePage}
            />
          {/each}
        </div>
      {/if}
    </main>
  </div>

  <!-- Bottom Status Bar -->
  <footer class="status-bar" class:err={statusKind === "error"} class:ok={statusKind === "success"}>
    <div class="status-left">
      <span class="status-msg">{statusMessage}</span>
    </div>
    <div class="status-right">
      {#if activeFilePath}
        <span class="st-item" title={activeFilePath}>
          {activeFileName} ({formatBytes(activeFileSize)})
        </span>
      {/if}
      <span class="st-item">
        選択: {selectedPagesList.length}/{virtualPages.length}P
      </span>
      <span class="st-item">
        ツール: {toolMode.toUpperCase()}
      </span>
      <span class="st-item">
        表示: {Math.round(zoomScale * 100)}%
      </span>
    </div>
  </footer>
</div>

<!-- Modals -->
{#if saveExtractModalMode}
  <SaveExtractModal
    mode={saveExtractModalMode}
    totalPages={virtualPages.length}
    initialPageSpec={pageSpecText || String(currentPage)}
    suggestedOutputPath={modalSuggestedPath}
    outputDir={currentDir}
    {baseFileStem}
    {isBusy}
    onClose={() => (saveExtractModalMode = null)}
    onConfirmSaveSingle={executeSaveSingle}
    onConfirmExtractIndividual={executeExtractIndividual}
  />
{/if}

{#if splitModalOpen}
  <SplitModal
    totalPages={virtualPages.length}
    initialSelectedSpec={pageSpecText}
    outputDir={currentDir}
    {baseFileStem}
    {isBusy}
    onClose={() => (splitModalOpen = false)}
    onExecuteSplit={executeSplit}
  />
{/if}

{#if mergeModalOpen}
  <MergeModal
    queue={mergeQueue}
    {folderEntries}
    suggestedOutputPath={mergeSuggestedPath}
    {isBusy}
    onClose={() => (mergeModalOpen = false)}
    onAddFileByPath={addFileToMergeQueue}
    onUpdateQueueItem={(id, patch) => {
      mergeQueue = mergeQueue.map((it) =>
        it.id === id ? { ...it, ...patch } : it
      );
    }}
    onMoveQueueItem={(id, dir) => {
      const idx = mergeQueue.findIndex((it) => it.id === id);
      const tIdx = idx + dir;
      if (idx < 0 || tIdx < 0 || tIdx >= mergeQueue.length) return;
      const copy = [...mergeQueue];
      const [moved] = copy.splice(idx, 1);
      copy.splice(tIdx, 0, moved);
      mergeQueue = copy;
    }}
    onDuplicateQueueItem={(id) => {
      const idx = mergeQueue.findIndex((it) => it.id === id);
      if (idx < 0) return;
      const orig = mergeQueue[idx];
      const dup: MergeQueueItem = {
        ...orig,
        id: `mq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      const copy = [...mergeQueue];
      copy.splice(idx + 1, 0, dup);
      mergeQueue = copy;
    }}
    onRemoveQueueItem={(id) => {
      mergeQueue = mergeQueue.filter((it) => it.id !== id);
    }}
    onExecuteMerge={executeMerge}
  />
{/if}

{#if overwriteConfirmOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="confirm-backdrop" onclick={() => (overwriteConfirmOpen = false)}>
    <div class="confirm-card" onclick={(e) => e.stopPropagation()}>
      <h3>⚠ 元ファイルの上書き保存確認</h3>
      <p>
        元のPDFファイル <code>{activeFilePath}</code> を現在の編集内容（全 {virtualPages.length} ページ）で直接上書きしますか？
      </p>
      <div class="confirm-btns">
        <button
          type="button"
          class="c-cancel"
          onclick={() => (overwriteConfirmOpen = false)}
        >
          キャンセル
        </button>
        <button
          type="button"
          class="c-save-as"
          onclick={() => {
            overwriteConfirmOpen = false;
            void openSaveOrExtractModal("save");
          }}
        >
          別名で保存にする（推奨）
        </button>
        <button
          type="button"
          class="c-danger"
          disabled={isBusy}
          onclick={executeOverwriteOriginal}
        >
          上書き保存を実行
        </button>
      </div>
    </div>
  </div>
{/if}

{#if helpModalOpen}
  <ShortcutHelpModal onClose={() => (helpModalOpen = false)} />
{/if}

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--ui-bg);
  }

  .workspace-body {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .main-viewer {
    flex: 1;
    overflow: auto;
    padding: 14px 20px;
    background: var(--nord0);
  }

  .continuous-pages-container,
  .single-page-container {
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .grid-overview-container {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
    gap: 16px;
    align-items: start;
  }

  .empty-viewer-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--nord3);
    font-size: 13px;
  }

  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 3px 12px;
    background: var(--ui-panel-bg);
    border-top: 1px solid var(--ui-border);
    font-size: 11px;
    color: var(--ui-fg);
  }

  .status-bar.ok .status-msg {
    color: var(--ui-success);
    font-weight: 700;
  }

  .status-bar.err .status-msg {
    color: var(--ui-danger);
    font-weight: 700;
  }

  .status-right {
    display: flex;
    gap: 12px;
  }

  .st-item {
    white-space: nowrap;
  }

  .confirm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 120;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .confirm-card {
    max-width: 480px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-danger);
    border-radius: 6px;
    padding: 16px;
  }

  .confirm-card h3 {
    margin: 0 0 8px 0;
    color: var(--ui-danger);
  }

  .confirm-btns {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }

  .c-cancel {
    padding: 5px 10px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
  }

  .c-save-as {
    padding: 5px 10px;
    background: var(--ui-accent);
    color: #111827;
    font-weight: 700;
  }

  .c-danger {
    padding: 5px 12px;
    background: var(--ui-danger);
    color: #ffffff;
    font-weight: 700;
  }
</style>

<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type {
    NormalizedPoint,
    NormalizedRect,
    PdfAnnotation,
    ToolMode,
    VirtualPage,
  } from "../types";

  interface TextSpanItem {
    str: string;
    leftPct: number;
    topPct: number;
    widthPct: number;
    heightPct: number;
    fontSizePx: number;
  }

  interface Props {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdfDoc: any;
    vPage: VirtualPage;
    displayPageNumber: number;
    scale: number;
    isCurrentPage: boolean;
    isSelected: boolean;
    toolMode: ToolMode;
    activeColor: string;
    activeStrokeWidth: number;
    activeFontSize: number;
    activeBgFill: boolean;
    annotations: PdfAnnotation[];
    selectedAnnotationId: string | null;
    searchQuery: string;
    onToggleSelectPage: (pageNum: number, shiftKey: boolean) => void;
    onRotatePage: (pageNum: number, delta: number) => void;
    onDeletePage: (pageNum: number) => void;
    onAddAnnotation: (ann: Omit<PdfAnnotation, "id" | "createdAt">) => void;
    onBeforeAnnotationChange: () => void;
    onUpdateAnnotation: (id: string, patch: Partial<PdfAnnotation>) => void;
    onDeleteAnnotation: (id: string) => void;
    onSelectAnnotation: (id: string | null) => void;
    onPageVisible?: (pageNum: number) => void;
  }

  let {
    pdfDoc,
    vPage,
    displayPageNumber,
    scale,
    isCurrentPage,
    isSelected,
    toolMode,
    activeColor,
    activeStrokeWidth,
    activeFontSize,
    activeBgFill,
    annotations,
    selectedAnnotationId,
    searchQuery,
    onToggleSelectPage,
    onRotatePage,
    onDeletePage,
    onAddAnnotation,
    onBeforeAnnotationChange,
    onUpdateAnnotation,
    onDeleteAnnotation,
    onSelectAnnotation,
    onPageVisible,
  }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state();
  let pageSurfaceEl: HTMLDivElement | undefined = $state();
  let canvasEl: HTMLCanvasElement | undefined = $state();
  let textLayerEl: HTMLDivElement | undefined = $state();

  let isNearViewport = $state(false);
  let textSpans = $state<TextSpanItem[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let activeRenderTask: any = null;
  let lastRenderKey = "";

  // Drawing interaction state
  let isDrawing = $state(false);
  let drawStart = $state<NormalizedPoint | null>(null);
  let drawCurrent = $state<NormalizedPoint | null>(null);
  let penPoints = $state<NormalizedPoint[]>([]);

  // Dragging existing annotation state
  let draggingAnnId = $state<string | null>(null);
  let dragStartPoint = $state<NormalizedPoint | null>(null);
  let dragOrigRects = $state<NormalizedRect[]>([]);
  let dragOrigPoints = $state<NormalizedPoint[]>([]);
  let dragUndoRecorded = false;

  // Inline text/sticky creation or editing
  let editingAnnId = $state<string | null>(null);
  let editingTextValue = $state("");
  let pendingNewTextPos = $state<NormalizedPoint | null>(null);
  let pendingNewTextKind = $state<"text" | "sticky">("text");
  let pendingNewTextValue = $state("");

  // Floating button for text selection highlight
  let selectionRects = $state<NormalizedRect[]>([]);
  let selectionPopupPos = $state<{ x: number; y: number } | null>(null);

  const totalRotation = $derived(
    (((vPage.baseRotation + vPage.addedRotation) % 360) + 360) % 360
  );
  const isSwapped = $derived(totalRotation === 90 || totalRotation === 270);
  const displayWidthPx = $derived(
    Math.round((isSwapped ? vPage.heightPt : vPage.widthPt) * scale)
  );
  const displayHeightPx = $derived(
    Math.round((isSwapped ? vPage.widthPt : vPage.heightPt) * scale)
  );

  // IntersectionObserver for lazy rendering + tracking visible page
  let io: IntersectionObserver | null = null;
  let visibilityIo: IntersectionObserver | null = null;

  onMount(() => {
    if (!containerEl) return;

    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            isNearViewport = true;
          } else {
            isNearViewport = false;
          }
        }
      },
      { rootMargin: "700px 0px 700px 0px", threshold: 0.01 }
    );
    io.observe(containerEl);

    visibilityIo = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
            onPageVisible?.(displayPageNumber);
          }
        }
      },
      { threshold: [0.35, 0.65] }
    );
    visibilityIo.observe(containerEl);
  });

  onDestroy(() => {
    io?.disconnect();
    visibilityIo?.disconnect();
    if (activeRenderTask) {
      try {
        activeRenderTask.cancel();
      } catch {
        // ignore
      }
    }
  });

  $effect(() => {
    const key = `${vPage.id}-${vPage.sourcePageIndex}-${totalRotation}-${scale.toFixed(3)}-${isNearViewport}`;
    if (!isNearViewport || !pdfDoc || !canvasEl) {
      return;
    }
    if (key === lastRenderKey) {
      return;
    }
    lastRenderKey = key;
    void renderPdfPage();
  });

  async function renderPdfPage() {
    if (!pdfDoc || !canvasEl) return;
    if (activeRenderTask) {
      try {
        activeRenderTask.cancel();
      } catch {
        // ignore
      }
      activeRenderTask = null;
    }

    try {
      const page = await pdfDoc.getPage(vPage.sourcePageIndex + 1);
      const viewport = page.getViewport({
        scale,
        rotation: totalRotation,
      });

      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvasEl.width = Math.floor(viewport.width * dpr);
      canvasEl.height = Math.floor(viewport.height * dpr);
      canvasEl.style.width = `${Math.floor(viewport.width)}px`;
      canvasEl.style.height = `${Math.floor(viewport.height)}px`;

      const ctx = canvasEl.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const renderTask = page.render({
        canvasContext: ctx,
        viewport,
      });
      activeRenderTask = renderTask;
      await renderTask.promise;

      // Extract positioned text items for text selection & search highlighting
      const textContent = await page.getTextContent();
      const spans: TextSpanItem[] = [];
      const vw = viewport.width || 1;
      const vh = viewport.height || 1;

      for (const item of textContent.items) {
        if (!item.str || !item.str.trim()) continue;
        // item.transform is [scaleX, skewY, skewX, scaleY, tx, ty] in PDF space
        const tx = viewport.transform;
        const m = item.transform;
        // Apply viewport transform to (m[4], m[5])
        const x = tx[0] * m[4] + tx[2] * m[5] + tx[4];
        const y = tx[1] * m[4] + tx[3] * m[5] + tx[5];
        const fontHeight = Math.hypot(m[2], m[3]) * scale;
        const w = (item.width ? item.width * scale : item.str.length * fontHeight * 0.55);
        const h = Math.max(10, fontHeight * 1.15);

        const leftPct = Math.max(0, Math.min(99, (x / vw) * 100));
        const topPct = Math.max(0, Math.min(99, ((y - fontHeight * 0.88) / vh) * 100));
        const widthPct = Math.max(0.5, Math.min(100 - leftPct, (w / vw) * 100));
        const heightPct = Math.max(1, Math.min(100 - topPct, (h / vh) * 100));

        spans.push({
          str: item.str,
          leftPct,
          topPct,
          widthPct,
          heightPct,
          fontSizePx: Math.max(9, fontHeight * 0.92),
        });
      }
      textSpans = spans;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("RenderingCancelled")) {
        console.warn("Page render warning:", msg);
      }
    }
  }

  function getNormalizedCoords(e: MouseEvent): NormalizedPoint {
    if (!pageSurfaceEl) return { x: 0, y: 0 };
    const rect = pageSurfaceEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / (rect.width || 1)));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / (rect.height || 1)));
    return { x, y };
  }

  function handleSurfaceMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    // Ignore clicks inside inline editor popups
    const target = e.target as HTMLElement;
    if (target.closest(".inline-text-editor") || target.closest(".selection-popup-btn")) {
      return;
    }

    onSelectAnnotation(null);
    const pt = getNormalizedCoords(e);

    if (toolMode === "text" || toolMode === "sticky") {
      e.preventDefault();
      pendingNewTextPos = pt;
      pendingNewTextKind = toolMode;
      pendingNewTextValue = "";
      return;
    }

    if (
      toolMode === "rect" ||
      toolMode === "line" ||
      toolMode === "arrow" ||
      toolMode === "pen" ||
      (toolMode === "highlight" && e.shiftKey)
    ) {
      e.preventDefault();
      isDrawing = true;
      drawStart = pt;
      drawCurrent = pt;
      penPoints = [pt];
    } else if (toolMode === "highlight") {
      // Allow either text selection OR rectangular highlight if no text is selected
      drawStart = pt;
      drawCurrent = pt;
      isDrawing = true;
    }
  }

  function handleSurfaceMouseMove(e: MouseEvent) {
    if (draggingAnnId && dragStartPoint) {
      e.preventDefault();
      const cur = getNormalizedCoords(e);
      const dx = cur.x - dragStartPoint.x;
      const dy = cur.y - dragStartPoint.y;

      if (!dragUndoRecorded && (dx !== 0 || dy !== 0)) {
        dragUndoRecorded = true;
        onBeforeAnnotationChange();
      }

      if (dragOrigRects.length > 0) {
        const updatedRects = dragOrigRects.map((r) => ({
          x: Math.max(0, Math.min(1 - r.w, r.x + dx)),
          y: Math.max(0, Math.min(1 - r.h, r.y + dy)),
          w: r.w,
          h: r.h,
        }));
        onUpdateAnnotation(draggingAnnId, { rects: updatedRects });
      } else if (dragOrigPoints.length > 0) {
        const updatedPoints = dragOrigPoints.map((p) => ({
          x: Math.max(0, Math.min(1, p.x + dx)),
          y: Math.max(0, Math.min(1, p.y + dy)),
        }));
        onUpdateAnnotation(draggingAnnId, { points: updatedPoints });
      }
      return;
    }

    if (!isDrawing || !drawStart) return;
    const pt = getNormalizedCoords(e);
    drawCurrent = pt;
    if (toolMode === "pen") {
      const last = penPoints[penPoints.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 0.004) {
        penPoints = [...penPoints, pt];
      }
    }
  }

  function handleSurfaceMouseUp(e: MouseEvent) {
    if (draggingAnnId) {
      draggingAnnId = null;
      dragStartPoint = null;
      return;
    }

    // Check if user selected text on this page
    const textRects = computeSelectedTextRectsOnPage();
    if (textRects.length > 0) {
      if (toolMode === "highlight") {
        // Immediately create highlight from selected text!
        onAddAnnotation({
          pageId: vPage.id,
          kind: "highlight",
          color: activeColor,
          strokeWidth: activeStrokeWidth,
          opacity: 0.36,
          rects: textRects,
          points: [],
        });
        window.getSelection()?.removeAllRanges();
        selectionRects = [];
        selectionPopupPos = null;
        isDrawing = false;
        drawStart = null;
        drawCurrent = null;
        return;
      } else {
        // In "select" mode, show floating "ハイライト" button above the selected text
        selectionRects = textRects;
        const first = textRects[0];
        selectionPopupPos = {
          x: Math.min(0.85, Math.max(0.05, first.x + first.w / 2)),
          y: Math.max(0.02, first.y - 0.04),
        };
      }
    } else {
      selectionRects = [];
      selectionPopupPos = null;
    }

    if (!isDrawing || !drawStart) {
      isDrawing = false;
      return;
    }

    const endPt = getNormalizedCoords(e);
    const minX = Math.min(drawStart.x, endPt.x);
    const minY = Math.min(drawStart.y, endPt.y);
    const w = Math.abs(endPt.x - drawStart.x);
    const h = Math.abs(endPt.y - drawStart.y);

    if (toolMode === "highlight" || toolMode === "rect") {
      if (w > 0.01 && h > 0.008) {
        onAddAnnotation({
          pageId: vPage.id,
          kind: toolMode,
          color: activeColor,
          strokeWidth: activeStrokeWidth,
          opacity: toolMode === "highlight" ? 0.36 : 0.95,
          rects: [{ x: minX, y: minY, w, h }],
          points: [],
        });
      }
    } else if (toolMode === "line" || toolMode === "arrow") {
      if (Math.hypot(endPt.x - drawStart.x, endPt.y - drawStart.y) > 0.015) {
        onAddAnnotation({
          pageId: vPage.id,
          kind: toolMode,
          color: activeColor,
          strokeWidth: activeStrokeWidth,
          opacity: 0.95,
          rects: [],
          points: [drawStart, endPt],
        });
      }
    } else if (toolMode === "pen") {
      if (penPoints.length >= 2) {
        onAddAnnotation({
          pageId: vPage.id,
          kind: "pen",
          color: activeColor,
          strokeWidth: activeStrokeWidth,
          opacity: 0.95,
          rects: [],
          points: penPoints,
        });
      }
    }

    isDrawing = false;
    drawStart = null;
    drawCurrent = null;
    penPoints = [];
  }

  function computeSelectedTextRectsOnPage(): NormalizedRect[] {
    if (!pageSurfaceEl || !textLayerEl) return [];
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return [];

    const range = sel.getRangeAt(0);
    if (!textLayerEl.contains(range.commonAncestorContainer)) {
      return [];
    }

    const surfaceRect = pageSurfaceEl.getBoundingClientRect();
    if (surfaceRect.width <= 0 || surfaceRect.height <= 0) return [];

    const clientRects = Array.from(range.getClientRects());
    const rects: NormalizedRect[] = [];

    for (const cr of clientRects) {
      if (cr.width < 2 || cr.height < 2) continue;
      const x = Math.max(0, Math.min(1, (cr.left - surfaceRect.left) / surfaceRect.width));
      const y = Math.max(0, Math.min(1, (cr.top - surfaceRect.top) / surfaceRect.height));
      const w = Math.max(0.005, Math.min(1 - x, cr.width / surfaceRect.width));
      const h = Math.max(0.005, Math.min(1 - y, cr.height / surfaceRect.height));
      rects.push({ x, y, w, h });
    }
    return rects;
  }

  function applyFloatingTextHighlight() {
    if (selectionRects.length === 0) return;
    onAddAnnotation({
      pageId: vPage.id,
      kind: "highlight",
      color: activeColor,
      strokeWidth: activeStrokeWidth,
      opacity: 0.36,
      rects: selectionRects,
      points: [],
    });
    window.getSelection()?.removeAllRanges();
    selectionRects = [];
    selectionPopupPos = null;
  }

  function commitPendingNewText() {
    if (!pendingNewTextPos) return;
    const trimmed = pendingNewTextValue.trim();
    if (trimmed) {
      onAddAnnotation({
        pageId: vPage.id,
        kind: pendingNewTextKind,
        color: activeColor,
        strokeWidth: activeStrokeWidth,
        opacity: 1,
        rects: [
          {
            x: pendingNewTextPos.x,
            y: pendingNewTextPos.y,
            w: pendingNewTextKind === "sticky" ? 0.24 : 0.22,
            h: pendingNewTextKind === "sticky" ? 0.1 : 0.05,
          },
        ],
        points: [],
        text: trimmed,
        fontSize: activeFontSize,
        bgFill: activeBgFill,
      });
    }
    pendingNewTextPos = null;
    pendingNewTextValue = "";
  }

  function startAnnotationDrag(e: MouseEvent, ann: PdfAnnotation) {
    e.stopPropagation();
    onSelectAnnotation(ann.id);
    if (toolMode !== "select") return;

    draggingAnnId = ann.id;
    dragStartPoint = getNormalizedCoords(e);
    dragUndoRecorded = false;
    dragOrigRects = ann.rects.map((r) => ({ ...r }));
    dragOrigPoints = ann.points.map((p) => ({ ...p }));
  }

  function startInlineEdit(e: MouseEvent, ann: PdfAnnotation) {
    e.stopPropagation();
    editingAnnId = ann.id;
    editingTextValue = ann.text ?? "";
  }

  function commitInlineEdit(annId: string) {
    const trimmed = editingTextValue.trim();
    if (trimmed) {
      const current = annotations.find((a) => a.id === annId);
      if (current?.text !== trimmed) {
        onBeforeAnnotationChange();
        onUpdateAnnotation(annId, { text: trimmed });
      }
    } else {
      onDeleteAnnotation(annId);
    }
    editingAnnId = null;
  }

  function computeArrowHeadPoints(p1: NormalizedPoint, p2: NormalizedPoint): string {
    const x1 = p1.x * displayWidthPx;
    const y1 = p1.y * displayHeightPx;
    const x2 = p2.x * displayWidthPx;
    const y2 = p2.y * displayHeightPx;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 12 * scale;
    const wing = Math.PI / 6;
    const wx1 = x2 - headLen * Math.cos(angle - wing);
    const wy1 = y2 - headLen * Math.sin(angle - wing);
    const wx2 = x2 - headLen * Math.cos(angle + wing);
    const wy2 = y2 - headLen * Math.sin(angle + wing);
    return `${wx1},${wy1} ${x2},${y2} ${wx2},${wy2}`;
  }

  const normalizedQuery = $derived(searchQuery.trim().toLowerCase());
  const matchingSpans = $derived(
    normalizedQuery.length > 0
      ? textSpans.filter((s) => s.str.toLowerCase().includes(normalizedQuery))
      : []
  );
</script>

<div
  bind:this={containerEl}
  class="page-card-wrapper"
  class:is-current={isCurrentPage}
  class:is-selected={isSelected}
  data-page-number={displayPageNumber}
>
  <!-- Page Header Bar for quick visual selection & page operations -->
  <div class="page-header-bar">
    <label class="page-select-checkbox" title="クリックで選択 / Shift+クリックで範囲選択">
      <input
        type="checkbox"
        checked={isSelected}
        onclick={(e) => {
          e.stopPropagation();
          onToggleSelectPage(displayPageNumber, (e as MouseEvent).shiftKey);
        }}
      />
      <span class="page-num-badge">
        P.{displayPageNumber}
        {#if vPage.originalPageNumber !== displayPageNumber}
          <span class="orig-num">(元#{vPage.originalPageNumber})</span>
        {/if}
      </span>
    </label>

    <div class="page-meta-pills">
      {#if totalRotation !== 0}
        <span class="rot-pill">{totalRotation}°</span>
      {/if}
      {#if annotations.length > 0}
        <span class="ann-pill">✎ {annotations.length}</span>
      {/if}
      {#if matchingSpans.length > 0}
        <span class="match-pill">検索一致: {matchingSpans.length}</span>
      {/if}
    </div>

    <div class="page-quick-actions">
      <button
        type="button"
        class="mini-btn"
        title="左に90°回転"
        onclick={() => onRotatePage(displayPageNumber, -90)}
      >
        ↺ 左90°
      </button>
      <button
        type="button"
        class="mini-btn"
        title="右に90°回転 (R)"
        onclick={() => onRotatePage(displayPageNumber, 90)}
      >
        ↻ 右90°
      </button>
      <button
        type="button"
        class="mini-btn danger"
        title="このページを削除"
        onclick={() => onDeletePage(displayPageNumber)}
      >
        × 削除
      </button>
    </div>
  </div>

  <!-- Main Page Surface -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={pageSurfaceEl}
    class="page-surface"
    class:cursor-crosshair={toolMode !== "select"}
    style="width: {displayWidthPx}px; height: {displayHeightPx}px;"
    onmousedown={handleSurfaceMouseDown}
    onmousemove={handleSurfaceMouseMove}
    onmouseup={handleSurfaceMouseUp}
  >
    {#if isNearViewport}
      <canvas bind:this={canvasEl} class="pdf-canvas"></canvas>

      <!-- Search Match Highlights -->
      {#if matchingSpans.length > 0}
        <div class="search-highlight-layer">
          {#each matchingSpans as m}
            <div
              class="search-hit-box"
              style="left: {m.leftPct}%; top: {m.topPct}%; width: {m.widthPct}%; height: {m.heightPct}%;"
            ></div>
          {/each}
        </div>
      {/if}

      <!-- Selectable Text Layer (active in select & highlight modes) -->
      <div
        bind:this={textLayerEl}
        class="pdf-text-layer"
        class:selectable={toolMode === "select" || toolMode === "highlight"}
      >
        {#each textSpans as span}
          <span
            class="pdf-text-span"
            style="left: {span.leftPct}%; top: {span.topPct}%; width: {span.widthPct}%; height: {span.heightPct}%; font-size: {span.fontSizePx}px;"
          >
            {span.str}
          </span>
        {/each}
      </div>

      <!-- SVG Vector Annotation Layer -->
      <svg
        class="annotation-svg-layer"
        viewBox="0 0 {displayWidthPx} {displayHeightPx}"
        width={displayWidthPx}
        height={displayHeightPx}
      >
        {#each annotations as ann (ann.id)}
          {@const isAnnSelected = ann.id === selectedAnnotationId}
          {#if ann.kind === "highlight"}
            <g
              class="ann-group"
              class:selected={isAnnSelected}
              onmousedown={(e) => startAnnotationDrag(e, ann)}
            >
              {#each ann.rects as r}
                <rect
                  x={r.x * displayWidthPx}
                  y={r.y * displayHeightPx}
                  width={r.w * displayWidthPx}
                  height={r.h * displayHeightPx}
                  fill={ann.color}
                  fill-opacity={ann.opacity ?? 0.36}
                  stroke={isAnnSelected ? "#38bdf8" : "none"}
                  stroke-width={isAnnSelected ? 2 : 0}
                />
              {/each}
            </g>
          {:else if ann.kind === "rect"}
            <g
              class="ann-group"
              class:selected={isAnnSelected}
              onmousedown={(e) => startAnnotationDrag(e, ann)}
            >
              {#each ann.rects as r}
                <rect
                  x={r.x * displayWidthPx}
                  y={r.y * displayHeightPx}
                  width={r.w * displayWidthPx}
                  height={r.h * displayHeightPx}
                  fill="transparent"
                  stroke={ann.color}
                  stroke-width={(ann.strokeWidth || 2) * scale}
                  stroke-dasharray={isAnnSelected ? "4 2" : "none"}
                />
              {/each}
            </g>
          {:else if ann.kind === "line" && ann.points.length >= 2}
            <g
              class="ann-group"
              class:selected={isAnnSelected}
              onmousedown={(e) => startAnnotationDrag(e, ann)}
            >
              <line
                x1={ann.points[0].x * displayWidthPx}
                y1={ann.points[0].y * displayHeightPx}
                x2={ann.points[ann.points.length - 1].x * displayWidthPx}
                y2={ann.points[ann.points.length - 1].y * displayHeightPx}
                stroke={ann.color}
                stroke-width={(ann.strokeWidth || 2.5) * scale}
                stroke-linecap="round"
              />
            </g>
          {:else if ann.kind === "arrow" && ann.points.length >= 2}
            <g
              class="ann-group"
              class:selected={isAnnSelected}
              onmousedown={(e) => startAnnotationDrag(e, ann)}
            >
              <line
                x1={ann.points[0].x * displayWidthPx}
                y1={ann.points[0].y * displayHeightPx}
                x2={ann.points[ann.points.length - 1].x * displayWidthPx}
                y2={ann.points[ann.points.length - 1].y * displayHeightPx}
                stroke={ann.color}
                stroke-width={(ann.strokeWidth || 2.5) * scale}
                stroke-linecap="round"
              />
              <polyline
                points={computeArrowHeadPoints(
                  ann.points[0],
                  ann.points[ann.points.length - 1]
                )}
                fill="none"
                stroke={ann.color}
                stroke-width={(ann.strokeWidth || 2.5) * scale}
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </g>
          {:else if ann.kind === "pen" && ann.points.length >= 2}
            <g
              class="ann-group"
              class:selected={isAnnSelected}
              onmousedown={(e) => startAnnotationDrag(e, ann)}
            >
              <polyline
                points={ann.points
                  .map((p) => `${p.x * displayWidthPx},${p.y * displayHeightPx}`)
                  .join(" ")}
                fill="none"
                stroke={ann.color}
                stroke-width={(ann.strokeWidth || 2.5) * scale}
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </g>
          {/if}
        {/each}

        <!-- Live Drawing Preview -->
        {#if isDrawing && drawStart && drawCurrent}
          {#if toolMode === "highlight" || toolMode === "rect"}
            <rect
              x={Math.min(drawStart.x, drawCurrent.x) * displayWidthPx}
              y={Math.min(drawStart.y, drawCurrent.y) * displayHeightPx}
              width={Math.abs(drawCurrent.x - drawStart.x) * displayWidthPx}
              height={Math.abs(drawCurrent.y - drawStart.y) * displayHeightPx}
              fill={toolMode === "highlight" ? activeColor : "none"}
              fill-opacity={toolMode === "highlight" ? 0.36 : 0}
              stroke={activeColor}
              stroke-width={toolMode === "rect" ? activeStrokeWidth * scale : 1}
              stroke-dasharray="4 2"
            />
          {:else if toolMode === "line" || toolMode === "arrow"}
            <line
              x1={drawStart.x * displayWidthPx}
              y1={drawStart.y * displayHeightPx}
              x2={drawCurrent.x * displayWidthPx}
              y2={drawCurrent.y * displayHeightPx}
              stroke={activeColor}
              stroke-width={activeStrokeWidth * scale}
              stroke-linecap="round"
            />
            {#if toolMode === "arrow"}
              <polyline
                points={computeArrowHeadPoints(drawStart, drawCurrent)}
                fill="none"
                stroke={activeColor}
                stroke-width={activeStrokeWidth * scale}
                stroke-linecap="round"
              />
            {/if}
          {:else if toolMode === "pen" && penPoints.length >= 2}
            <polyline
              points={penPoints
                .map((p) => `${p.x * displayWidthPx},${p.y * displayHeightPx}`)
                .join(" ")}
              fill="none"
              stroke={activeColor}
              stroke-width={activeStrokeWidth * scale}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          {/if}
        {/if}
      </svg>

      <!-- HTML Layer for Text Annotations, Sticky Notes, and Inline Editors -->
      <div class="html-annotation-layer">
        {#each annotations as ann (ann.id)}
          {#if (ann.kind === "text" || ann.kind === "sticky") && ann.rects.length > 0}
            {@const r = ann.rects[0]}
            {@const isAnnSelected = ann.id === selectedAnnotationId}
            {#if editingAnnId === ann.id}
              <div
                class="inline-text-editor"
                style="left: {r.x * 100}%; top: {r.y * 100}%;"
              >
                <textarea
                  rows="3"
                  bind:value={editingTextValue}
                   onkeydown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      commitInlineEdit(ann.id);
                    } else if (e.key === "Escape") {
                      editingAnnId = null;
                    }
                  }}
                ></textarea>
                <div class="editor-btn-row">
                  <button type="button" class="ed-save" onclick={() => commitInlineEdit(ann.id)}>
                    確定 (Ctrl+Enter)
                  </button>
                  <button type="button" class="ed-del" onclick={() => onDeleteAnnotation(ann.id)}>
                    削除
                  </button>
                </div>
              </div>
            {:else}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="placed-text-card"
                class:sticky-card={ann.kind === "sticky"}
                class:has-bg={ann.kind === "text" && ann.bgFill}
                class:selected={isAnnSelected}
                style="left: {r.x * 100}%; top: {r.y * 100}%; font-size: {(ann.fontSize ?? 14) * scale}px; color: {ann.kind === 'sticky' ? '#111827' : ann.color}; border-color: {ann.color};"
                onmousedown={(e) => startAnnotationDrag(e, ann)}
                ondblclick={(e) => startInlineEdit(e, ann)}
                title="ドラッグで移動 / ダブルクリックで編集"
              >
                {#if ann.kind === "sticky"}
                  <div class="sticky-card-header" style="background: {ann.color};">
                    <span>NOTE / メモ</span>
                    <button
                      type="button"
                      class="ann-close-x"
                      onclick={(e) => {
                        e.stopPropagation();
                        onDeleteAnnotation(ann.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                {/if}
                <div class="placed-text-body">{ann.text}</div>
                {#if isAnnSelected && ann.kind !== "sticky"}
                  <button
                    type="button"
                    class="floating-del-badge"
                    onclick={(e) => {
                      e.stopPropagation();
                      onDeleteAnnotation(ann.id);
                    }}
                  >
                    ×
                  </button>
                {/if}
              </div>
            {/if}
          {/if}
        {/each}

        <!-- New Text / Sticky Note Input Popup -->
        {#if pendingNewTextPos}
          <div
            class="inline-text-editor"
            style="left: {Math.min(72, pendingNewTextPos.x * 100)}%; top: {Math.min(80, pendingNewTextPos.y * 100)}%;"
          >
            <div class="editor-title">
              {pendingNewTextKind === "sticky" ? "付箋メモを追加" : "テキスト注釈を追加"}
            </div>
            <!-- svelte-ignore a11y_autofocus -->
            <textarea
              autofocus
              rows="3"
              placeholder="文字を入力 (日本語対応・複数行可)..."
              bind:value={pendingNewTextValue}
              onkeydown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  commitPendingNewText();
                } else if (e.key === "Escape") {
                  pendingNewTextPos = null;
                }
              }}
            ></textarea>
            <div class="editor-btn-row">
              <button type="button" class="ed-save" onclick={commitPendingNewText}>
                追加 (Ctrl+Enter)
              </button>
              <button
                type="button"
                class="ed-cancel"
                onclick={() => {
                  pendingNewTextPos = null;
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        {/if}

        <!-- Floating Text Selection Highlight Button -->
        {#if selectionPopupPos && selectionRects.length > 0}
          <button
            type="button"
            class="selection-popup-btn"
            style="left: {selectionPopupPos.x * 100}%; top: {selectionPopupPos.y * 100}%;"
            onclick={applyFloatingTextHighlight}
          >
            <span class="swatch-dot" style="background: {activeColor};"></span>
            選択文字をハイライト (H)
          </button>
        {/if}
      </div>
    {:else}
      <div class="page-placeholder">
        <span>ページ {displayPageNumber} 読み込み中...</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .page-card-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0 auto 20px auto;
    padding: 6px;
    border-radius: 6px;
    border: 2px solid transparent;
    transition: border-color 0.12s ease, background-color 0.12s ease;
  }

  .page-card-wrapper.is-current {
    border-color: var(--ui-accent-blue);
  }

  .page-card-wrapper.is-selected {
    border-color: var(--ui-accent);
    background-color: rgba(136, 192, 208, 0.08);
  }

  .page-header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    max-width: 100%;
    padding: 4px 10px;
    margin-bottom: 4px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    gap: 10px;
  }

  .page-select-checkbox {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-weight: 600;
    color: var(--ui-fg-bright);
  }

  .page-select-checkbox input[type="checkbox"] {
    width: 15px;
    height: 15px;
    accent-color: var(--ui-accent);
    cursor: pointer;
  }

  .orig-num {
    font-size: 11px;
    color: var(--nord3);
    font-weight: normal;
  }

  .page-meta-pills {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }

  .rot-pill {
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--nord2);
    color: var(--nord13);
  }

  .ann-pill {
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--nord2);
    color: var(--nord14);
  }

  .match-pill {
    padding: 1px 6px;
    border-radius: 3px;
    background: var(--nord13);
    color: #111827;
    font-weight: 700;
  }

  .page-quick-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .mini-btn {
    padding: 2px 7px;
    font-size: 11px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    border-radius: 3px;
    color: var(--ui-fg);
  }

  .mini-btn:hover {
    background: var(--ui-hover-bg);
    color: var(--ui-fg-bright);
    border-color: var(--ui-accent);
  }

  .mini-btn.danger:hover {
    border-color: var(--ui-danger);
    color: var(--ui-danger);
  }

  .page-surface {
    position: relative;
    background: #ffffff;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.38);
    overflow: hidden;
  }

  .page-surface.cursor-crosshair {
    cursor: crosshair;
  }

  .pdf-canvas {
    display: block;
    pointer-events: none;
  }

  .search-highlight-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2;
  }

  .search-hit-box {
    position: absolute;
    background: rgba(249, 115, 22, 0.42);
    border: 1px solid rgba(234, 88, 12, 0.9);
    border-radius: 2px;
  }

  .pdf-text-layer {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
  }

  .pdf-text-layer.selectable {
    pointer-events: auto;
    user-select: text;
  }

  .pdf-text-span {
    position: absolute;
    color: transparent;
    white-space: pre;
    line-height: 1;
    cursor: text;
  }

  .pdf-text-span::selection {
    background: rgba(56, 189, 248, 0.35);
    color: transparent;
  }

  .annotation-svg-layer {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
  }

  .ann-group {
    pointer-events: all;
    cursor: move;
  }

  .html-annotation-layer {
    position: absolute;
    inset: 0;
    z-index: 5;
    pointer-events: none;
  }

  .placed-text-card {
    position: absolute;
    pointer-events: auto;
    cursor: move;
    padding: 3px 6px;
    border: 1px dashed transparent;
    border-radius: 3px;
    line-height: 1.35;
    white-space: pre-wrap;
    font-family: "BIZ UDGothic", "Yu Gothic UI", "Meiryo", sans-serif;
    font-weight: 600;
    max-width: 85%;
  }

  .placed-text-card.has-bg {
    background: rgba(255, 255, 255, 0.92);
    border: 1px solid currentColor;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
  }

  .placed-text-card.sticky-card {
    background: rgba(254, 249, 195, 0.96);
    border: 1.5px solid #eab308;
    border-radius: 5px;
    padding: 0;
    min-width: 130px;
    box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25);
    font-weight: 500;
  }

  .sticky-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 700;
    color: #111827;
  }

  .placed-text-card.sticky-card .placed-text-body {
    padding: 5px 8px;
    color: #111827;
  }

  .placed-text-card.selected {
    outline: 2px solid #38bdf8;
  }

  .ann-close-x,
  .floating-del-badge {
    background: #ef4444;
    color: #ffffff;
    border-radius: 50%;
    width: 16px;
    height: 16px;
    font-size: 11px;
    line-height: 14px;
    text-align: center;
    padding: 0;
  }

  .floating-del-badge {
    position: absolute;
    top: -8px;
    right: -8px;
  }

  .inline-text-editor {
    position: absolute;
    pointer-events: auto;
    z-index: 20;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-accent);
    border-radius: 5px;
    padding: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
    min-width: 230px;
  }

  .editor-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--ui-accent);
    margin-bottom: 4px;
  }

  .inline-text-editor textarea {
    width: 100%;
    resize: both;
    font-family: "BIZ UDGothic", "Yu Gothic UI", sans-serif;
    font-size: 13px;
    margin-bottom: 6px;
  }

  .editor-btn-row {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .ed-save {
    background: var(--ui-accent);
    color: #111827;
    font-weight: 700;
    padding: 3px 8px;
    font-size: 11px;
  }

  .ed-cancel,
  .ed-del {
    background: var(--nord2);
    color: var(--ui-fg);
    padding: 3px 8px;
    font-size: 11px;
  }

  .ed-del:hover {
    background: var(--ui-danger);
    color: #fff;
  }

  .selection-popup-btn {
    position: absolute;
    transform: translateX(-50%);
    pointer-events: auto;
    z-index: 25;
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--nord0);
    color: var(--ui-fg-bright);
    border: 1px solid var(--ui-accent);
    border-radius: 16px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 700;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.45);
  }

  .selection-popup-btn:hover {
    background: var(--ui-hover-bg);
  }

  .swatch-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-block;
  }

  .page-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: #6b7280;
    background: #f9fafb;
    font-size: 13px;
  }
</style>

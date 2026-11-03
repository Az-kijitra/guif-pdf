<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { VirtualPage } from "../types";

  interface Props {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pdfDoc: any;
    vPage: VirtualPage;
    displayPageNumber: number;
    isCurrent: boolean;
    isSelected: boolean;
    annotationCount: number;
    thumbWidth?: number;
    onJumpToPage: (pageNum: number) => void;
    onToggleSelect: (pageNum: number, shiftKey: boolean) => void;
    onRotatePage: (pageNum: number, delta: number) => void;
    onMovePage?: (pageNum: number, direction: -1 | 1) => void;
    onDeletePage?: (pageNum: number) => void;
  }

  let {
    pdfDoc,
    vPage,
    displayPageNumber,
    isCurrent,
    isSelected,
    annotationCount,
    thumbWidth = 140,
    onJumpToPage,
    onToggleSelect,
    onRotatePage,
    onMovePage,
    onDeletePage,
  }: Props = $props();

  let itemEl: HTMLDivElement | undefined = $state();
  let canvasEl: HTMLCanvasElement | undefined = $state();
  let isVisible = $state(false);
  let lastRenderKey = "";

  const totalRotation = $derived(
    (((vPage.baseRotation + vPage.addedRotation) % 360) + 360) % 360
  );
  const isSwapped = $derived(totalRotation === 90 || totalRotation === 270);
  const aspect = $derived(
    (isSwapped ? vPage.widthPt : vPage.heightPt) /
      Math.max(1, isSwapped ? vPage.heightPt : vPage.widthPt)
  );
  const thumbHeight = $derived(Math.round(thumbWidth * aspect));

  let io: IntersectionObserver | null = null;

  onMount(() => {
    if (!itemEl) return;
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          isVisible = e.isIntersecting;
        }
      },
      { rootMargin: "350px 0px 350px 0px", threshold: 0.01 }
    );
    io.observe(itemEl);
  });

  onDestroy(() => {
    io?.disconnect();
  });

  $effect(() => {
    const key = `${vPage.id}-${vPage.sourcePageIndex}-${totalRotation}-${thumbWidth}-${isVisible}`;
    if (!isVisible || !pdfDoc || !canvasEl) return;
    if (key === lastRenderKey) return;
    lastRenderKey = key;
    void renderThumb();
  });

  async function renderThumb() {
    if (!pdfDoc || !canvasEl) return;
    try {
      const page = await pdfDoc.getPage(vPage.sourcePageIndex + 1);
      const unscaledVp = page.getViewport({ scale: 1, rotation: totalRotation });
      const scale = thumbWidth / Math.max(1, unscaledVp.width);
      const vp = page.getViewport({ scale, rotation: totalRotation });

      canvasEl.width = Math.floor(vp.width);
      canvasEl.height = Math.floor(vp.height);
      const ctx = canvasEl.getContext("2d");
      if (!ctx) return;

      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } catch {
      // ignore thumbnail cancellation
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={itemEl}
  class="thumb-card"
  class:current={isCurrent}
  class:selected={isSelected}
  onclick={(e) => {
    if ((e.target as HTMLElement).closest("input, button, label")) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      onToggleSelect(displayPageNumber, e.shiftKey);
    } else {
      onJumpToPage(displayPageNumber);
    }
  }}
>
  <div class="thumb-top-bar">
    <label
      class="thumb-check-label"
      title="選択 / Shift+クリックで範囲選択"
      onclick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={isSelected}
        onclick={(e) => {
          e.stopPropagation();
          onToggleSelect(displayPageNumber, (e as MouseEvent).shiftKey);
        }}
      />
      <span class="p-num">P.{displayPageNumber}</span>
      {#if vPage.originalPageNumber !== displayPageNumber}
        <span class="p-orig">(#{vPage.originalPageNumber})</span>
      {/if}
    </label>

    <div class="thumb-badges">
      {#if totalRotation !== 0}
        <span class="badge-rot">{totalRotation}°</span>
      {/if}
      {#if annotationCount > 0}
        <span class="badge-ann">✎{annotationCount}</span>
      {/if}
    </div>
  </div>

  <div
    class="thumb-canvas-wrap"
    style="width: {thumbWidth}px; height: {thumbHeight}px;"
  >
    {#if isVisible}
      <canvas bind:this={canvasEl} class="thumb-canvas"></canvas>
    {:else}
      <div class="thumb-skeleton">P.{displayPageNumber}</div>
    {/if}
  </div>

  <div class="thumb-actions">
    <button
      type="button"
      class="t-btn"
      title="左90°回転"
      onclick={(e) => {
        e.stopPropagation();
        onRotatePage(displayPageNumber, -90);
      }}
    >
      ↺
    </button>
    <button
      type="button"
      class="t-btn"
      title="右90°回転"
      onclick={(e) => {
        e.stopPropagation();
        onRotatePage(displayPageNumber, 90);
      }}
    >
      ↻
    </button>
    {#if onMovePage}
      <button
        type="button"
        class="t-btn"
        title="ページを前へ移動"
        onclick={(e) => {
          e.stopPropagation();
          onMovePage(displayPageNumber, -1);
        }}
      >
        ↑
      </button>
      <button
        type="button"
        class="t-btn"
        title="ページを後ろへ移動"
        onclick={(e) => {
          e.stopPropagation();
          onMovePage(displayPageNumber, 1);
        }}
      >
        ↓
      </button>
    {/if}
    {#if onDeletePage}
      <button
        type="button"
        class="t-btn danger"
        title="このページを削除"
        onclick={(e) => {
          e.stopPropagation();
          onDeletePage(displayPageNumber);
        }}
      >
        ×
      </button>
    {/if}
  </div>
</div>

<style>
  .thumb-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 6px;
    border-radius: 5px;
    background: var(--nord0);
    border: 1.5px solid var(--ui-border);
    cursor: pointer;
    transition: border-color 0.12s ease, background-color 0.12s ease;
  }

  .thumb-card:hover {
    border-color: var(--ui-accent-blue);
    background: var(--ui-hover-bg);
  }

  .thumb-card.current {
    border-color: var(--ui-accent-blue);
    box-shadow: 0 0 0 1px var(--ui-accent-blue);
  }

  .thumb-card.selected {
    border-color: var(--ui-accent);
    background: rgba(136, 192, 208, 0.14);
  }

  .thumb-top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    margin-bottom: 4px;
    font-size: 11px;
  }

  .thumb-check-label {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    font-weight: 700;
    color: var(--ui-fg-bright);
  }

  .thumb-check-label input[type="checkbox"] {
    accent-color: var(--ui-accent);
    cursor: pointer;
  }

  .p-orig {
    font-weight: normal;
    color: var(--nord3);
    font-size: 10px;
  }

  .thumb-badges {
    display: flex;
    gap: 3px;
    font-size: 10px;
  }

  .badge-rot {
    padding: 0 4px;
    background: var(--nord2);
    color: var(--nord13);
    border-radius: 3px;
  }

  .badge-ann {
    padding: 0 4px;
    background: var(--nord2);
    color: var(--nord14);
    border-radius: 3px;
  }

  .thumb-canvas-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ffffff;
    border-radius: 2px;
    overflow: hidden;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
  }

  .thumb-canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
  }

  .thumb-skeleton {
    font-size: 11px;
    color: #9ca3af;
  }

  .thumb-actions {
    display: flex;
    gap: 3px;
    margin-top: 5px;
    width: 100%;
    justify-content: center;
  }

  .t-btn {
    padding: 1px 6px;
    font-size: 11px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-border);
    border-radius: 3px;
    color: var(--ui-fg);
  }

  .t-btn:hover {
    border-color: var(--ui-accent);
    color: var(--ui-fg-bright);
  }

  .t-btn.danger:hover {
    border-color: var(--ui-danger);
    color: var(--ui-danger);
  }
</style>

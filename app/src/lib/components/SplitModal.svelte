<script lang="ts">
  import {
    computeSplitByBreakpoints,
    computeSplitEveryN,
    parseSplitRangeGroups,
  } from "../pageRangeParser";
  import type { SplitGroupPreview } from "../types";

  interface Props {
    totalPages: number;
    initialSelectedSpec: string;
    outputDir: string;
    baseFileStem: string;
    isBusy: boolean;
    onClose: () => void;
    onExecuteSplit: (opts: {
      groups: SplitGroupPreview[];
      outputDir: string;
      includeAnnotations: boolean;
      allowOverwrite: boolean;
    }) => void;
  }

  let {
    totalPages,
    initialSelectedSpec,
    outputDir,
    baseFileStem,
    isBusy,
    onClose,
    onExecuteSplit,
  }: Props = $props();

  let splitMode = $state<"ranges" | "breakpoints" | "every_n">("ranges");
  let rangesSpec = $state("");
  let breakpointsSpec = $state("");
  let everyN = $state(10);
  let targetDir = $state("");
  let customStem = $state("");
  let includeAnnotations = $state(true);
  let allowOverwrite = $state(false);

  $effect(() => {
    targetDir = outputDir;
    customStem = baseFileStem;
    const mid = Math.max(1, Math.floor(totalPages / 2));
    rangesSpec = totalPages > 1 ? `1-${mid}; ${mid + 1}-end` : "1";
    breakpointsSpec = initialSelectedSpec || String(mid);
  });

  const computedPreview = $derived.by(() => {
    const stem = customStem.trim() || baseFileStem || "document";
    if (splitMode === "ranges") {
      return parseSplitRangeGroups(rangesSpec, totalPages, stem);
    } else if (splitMode === "breakpoints") {
      return computeSplitByBreakpoints(breakpointsSpec, totalPages, stem);
    } else {
      return computeSplitEveryN(Number(everyN), totalPages, stem);
    }
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onClose}>
  <div class="modal-card" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h3>⇕ PDF分割 (ページ範囲・分割位置・均等ページ数)</h3>
      <button type="button" class="close-btn" onclick={onClose}>×</button>
    </div>

    <div class="modal-body">
      <div class="mode-tabs">
        <button
          type="button"
          class="m-tab"
          class:active={splitMode === "ranges"}
          onclick={() => (splitMode = "ranges")}
        >
          ① ページ範囲リストで分割
        </button>
        <button
          type="button"
          class="m-tab"
          class:active={splitMode === "breakpoints"}
          onclick={() => (splitMode = "breakpoints")}
        >
          ② 区切りページ番号で分割
        </button>
        <button
          type="button"
          class="m-tab"
          class:active={splitMode === "every_n"}
          onclick={() => (splitMode = "every_n")}
        >
          ③ Nページごとに均等分割
        </button>
      </div>

      {#if splitMode === "ranges"}
        <div class="field-group">
          <label for="split-ranges-input">
            出力ファイルごとのページ範囲をセミコロン <code>;</code> 区切りで指定 (全 {totalPages}P):
          </label>
          <input
            id="split-ranges-input"
            type="text"
            class="full-input"
            placeholder="例: 1-10; 11-25; 26-end"
            bind:value={rangesSpec}
          />
          <div class="hint-text">
            各パートには <code>1-5, 8</code> や <code>odd</code>, <code>!1</code> などの書式も使えます。
          </div>
        </div>
      {:else if splitMode === "breakpoints"}
        <div class="field-group">
          <label for="split-bp-input">
            どのページの直後で分割するかをカンマ区切りで指定 (1〜{Math.max(1, totalPages - 1)}):
          </label>
          <div class="row-with-btn">
            <input
              id="split-bp-input"
              type="text"
              class="full-input"
              placeholder="例: 5, 15, 30 (5Pの後、15Pの後、30Pの後で分割)"
              bind:value={breakpointsSpec}
            />
            {#if initialSelectedSpec}
              <button
                type="button"
                class="use-sel-btn"
                onclick={() => (breakpointsSpec = initialSelectedSpec)}
              >
                現在の選択ページをセット
              </button>
            {/if}
          </div>
        </div>
      {:else}
        <div class="field-group">
          <label for="split-every-input">何ページごとに分割しますか？</label>
          <div class="every-row">
            <input
              id="split-every-input"
              type="number"
              min="1"
              max={totalPages}
              class="num-input"
              bind:value={everyN}
            />
            <span>ページごとに分割</span>
            <button type="button" class="chip" onclick={() => (everyN = 1)}>1ページずつ全分割</button>
            <button type="button" class="chip" onclick={() => (everyN = 5)}>5Pごと</button>
            <button type="button" class="chip" onclick={() => (everyN = 10)}>10Pごと</button>
            <button type="button" class="chip" onclick={() => (everyN = 20)}>20Pごと</button>
          </div>
        </div>
      {/if}

      <div class="two-col">
        <div class="field-group">
          <label for="split-dir">出力先フォルダー:</label>
          <input id="split-dir" type="text" class="full-input" bind:value={targetDir} />
        </div>
        <div class="field-group">
          <label for="split-stem">ファイル名ベース:</label>
          <input id="split-stem" type="text" class="full-input" bind:value={customStem} />
        </div>
      </div>

      <!-- Preview Table -->
      <div class="preview-box">
        <div class="preview-header">
          {#if computedPreview.error}
            <span class="err-text">⚠ {computedPreview.error}</span>
          {:else}
            <span class="ok-text">
              ✓ 出力プレビュー: 合計 <strong>{computedPreview.groups.length}</strong> ファイルを作成します
            </span>
          {/if}
        </div>
        {#if !computedPreview.error && computedPreview.groups.length > 0}
          <div class="preview-list">
            {#each computedPreview.groups as g}
              <div class="preview-row">
                <span class="p-idx">#{g.index}</span>
                <span class="p-fname">{g.suggestedFileName}</span>
                <span class="p-pages">P.{g.label} ({g.pages.length}ページ)</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="options-row">
        <label class="check-row">
          <input type="checkbox" bind:checked={includeAnnotations} />
          <span>注釈・ハイライトを含める</span>
        </label>
        <label class="check-row">
          <input type="checkbox" bind:checked={allowOverwrite} />
          <span>既存ファイルの上書きを許可する</span>
        </label>
      </div>
    </div>

    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick={onClose} disabled={isBusy}>
        キャンセル
      </button>
      <button
        type="button"
        class="btn-primary"
        disabled={isBusy || !!computedPreview.error || computedPreview.groups.length === 0}
        onclick={() =>
          onExecuteSplit({
            groups: computedPreview.groups,
            outputDir: targetDir.trim(),
            includeAnnotations,
            allowOverwrite,
          })}
      >
        {isBusy ? "分割処理中..." : `${computedPreview.groups.length} 個のPDFに分割実行`}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-card {
    width: 100%;
    max-width: 640px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-accent);
    border-radius: 6px;
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: var(--nord0);
    border-bottom: 1px solid var(--ui-border);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 14px;
    color: var(--ui-fg-bright);
  }

  .close-btn {
    font-size: 18px;
    padding: 0 6px;
  }

  .modal-body {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .mode-tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }

  .m-tab {
    padding: 6px 8px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    font-size: 12px;
    font-weight: 600;
  }

  .m-tab.active {
    background: var(--ui-accent);
    color: #111827;
    border-color: var(--ui-accent);
    font-weight: 700;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .field-group label {
    font-size: 12px;
    font-weight: 700;
    color: var(--ui-fg-bright);
  }

  .full-input {
    width: 100%;
    padding: 6px 9px;
    font-size: 12px;
  }

  .row-with-btn,
  .every-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .num-input {
    width: 80px;
    text-align: center;
  }

  .use-sel-btn,
  .chip {
    padding: 4px 8px;
    font-size: 11px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    white-space: nowrap;
  }

  .use-sel-btn:hover,
  .chip:hover {
    border-color: var(--ui-accent);
    color: var(--ui-accent);
  }

  .hint-text {
    font-size: 11px;
    color: var(--nord4);
  }

  .two-col {
    display: grid;
    grid-template-columns: 1.6fr 1fr;
    gap: 10px;
  }

  .preview-box {
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    border-radius: 4px;
    padding: 8px 10px;
  }

  .preview-header {
    font-size: 12px;
    margin-bottom: 6px;
  }

  .err-text {
    color: var(--ui-danger);
    font-weight: 700;
  }

  .ok-text {
    color: var(--ui-success);
  }

  .preview-list {
    max-height: 150px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .preview-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    padding: 3px 6px;
    background: var(--ui-panel-bg);
    border-radius: 3px;
  }

  .p-idx {
    color: var(--ui-accent);
    font-weight: 700;
    min-width: 24px;
  }

  .p-fname {
    flex: 1;
    color: var(--ui-fg-bright);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .p-pages {
    color: var(--nord13);
    white-space: nowrap;
  }

  .options-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .check-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    cursor: pointer;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 14px;
    background: var(--nord0);
    border-top: 1px solid var(--ui-border);
  }

  .btn-secondary {
    padding: 5px 12px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-border);
  }

  .btn-primary {
    padding: 5px 14px;
    background: var(--ui-accent);
    color: #111827;
    font-weight: 700;
    border: 1px solid var(--ui-accent);
  }
</style>

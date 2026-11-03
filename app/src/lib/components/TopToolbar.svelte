<script lang="ts">
  import type { ToolMode } from "../types";

  interface Props {
    hasPdf: boolean;
    annotationBarOpen: boolean;
    toolMode: ToolMode;
    activeColor: string;
    activeStrokeWidth: number;
    activeFontSize: number;
    activeBgFill: boolean;
    canUndo: boolean;
    canRedo: boolean;
    searchOpen: boolean;
    searchQuery: string;
    searchHitPages: number[];
    onChangeTool: (tool: ToolMode) => void;
    onChangeColor: (color: string) => void;
    onChangeStrokeWidth: (w: number) => void;
    onChangeFontSize: (s: number) => void;
    onToggleBgFill: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onCloseAnnotationBar: () => void;
    onToggleSearch: () => void;
    onSearchQueryChange: (q: string) => void;
    onJumpNextSearchHit: (dir: -1 | 1) => void;
  }

  let {
    hasPdf,
    annotationBarOpen,
    toolMode,
    activeColor,
    activeStrokeWidth,
    activeFontSize,
    activeBgFill,
    canUndo,
    canRedo,
    searchOpen,
    searchQuery,
    searchHitPages,
    onChangeTool,
    onChangeColor,
    onChangeStrokeWidth,
    onChangeFontSize,
    onToggleBgFill,
    onUndo,
    onRedo,
    onCloseAnnotationBar,
    onToggleSearch,
    onSearchQueryChange,
    onJumpNextSearchHit,
  }: Props = $props();

  const COLORS = [
    { hex: "#facc15", name: "イエロー" },
    { hex: "#4ade80", name: "グリーン" },
    { hex: "#38bdf8", name: "シアン" },
    { hex: "#f472b6", name: "ピンク" },
    { hex: "#fb923c", name: "オレンジ" },
    { hex: "#ef4444", name: "レッド" },
    { hex: "#3b82f6", name: "ブルー" },
  ];

  const TOOLS: Array<{ id: ToolMode; label: string; key: string; tip: string }> = [
    { id: "select", label: "選択", key: "V", tip: "テキスト選択・注釈の移動/編集 (V)" },
    { id: "highlight", label: "ハイライト", key: "H", tip: "文字選択または矩形ドラッグでハイライト (H)" },
    { id: "text", label: "文字記入", key: "T", tip: "クリックした位置に日本語/英数テキストを書き込み (T)" },
    { id: "sticky", label: "付箋メモ", key: "N", tip: "クリックした位置に付箋メモカードを追加 (N)" },
    { id: "rect", label: "四角枠", key: "B", tip: "ドラッグで四角形枠を描画 (B)" },
    { id: "arrow", label: "矢印", key: "A", tip: "ドラッグで矢印を描画 (A)" },
    { id: "line", label: "直線", key: "L", tip: "ドラッグで直線を描画 (L)" },
    { id: "pen", label: "ペン", key: "P", tip: "フリーハンド手書き描画 (P)" },
  ];
</script>

{#if annotationBarOpen}
  <div class="collapsible-annotation-bar">
    <div class="tool-selector">
      <span class="row-label">注釈:</span>
      {#each TOOLS as t}
        <button
          type="button"
          class="tool-btn"
          class:active={toolMode === t.id}
          disabled={!hasPdf}
          title={t.tip}
          onclick={() => onChangeTool(t.id)}
        >
          <span>{t.label}</span>
          <kbd>{t.key}</kbd>
        </button>
      {/each}
    </div>

    <div class="style-selector">
      <span class="row-label">色:</span>
      <div class="color-swatches">
        {#each COLORS as c}
          <button
            type="button"
            class="color-dot"
            class:selected={activeColor.toLowerCase() === c.hex.toLowerCase()}
            style="background-color: {c.hex};"
            title={c.name}
            onclick={() => onChangeColor(c.hex)}
          ></button>
        {/each}
      </div>

      {#if toolMode === "text" || toolMode === "sticky"}
        <span class="row-label">文字サイズ:</span>
        <select
          class="mini-select"
          value={activeFontSize}
          onchange={(e) => onChangeFontSize(Number((e.currentTarget as HTMLSelectElement).value))}
        >
          <option value={11}>11pt</option>
          <option value={14}>14pt</option>
          <option value={18}>18pt</option>
          <option value={22}>22pt</option>
          <option value={28}>28pt</option>
        </select>
        {#if toolMode === "text"}
          <label class="bg-fill-check" title="文字の背面に白背景ボックスを付ける">
            <input type="checkbox" checked={activeBgFill} onchange={onToggleBgFill} />
            <span>白背景枠</span>
          </label>
        {/if}
      {:else if toolMode === "rect" || toolMode === "arrow" || toolMode === "line" || toolMode === "pen"}
        <span class="row-label">線の太さ:</span>
        <select
          class="mini-select"
          value={activeStrokeWidth}
          onchange={(e) => onChangeStrokeWidth(Number((e.currentTarget as HTMLSelectElement).value))}
        >
          <option value={1.5}>細 (1.5px)</option>
          <option value={2.5}>標準 (2.5px)</option>
          <option value={4}>太 (4px)</option>
          <option value={6}>極太 (6px)</option>
        </select>
      {/if}

      <button
        type="button"
        class="mini-action-btn"
        disabled={!canUndo}
        title="元に戻す (Ctrl+Z)"
        onclick={onUndo}
      >
        ↶ 戻す
      </button>
      <button
        type="button"
        class="mini-action-btn"
        disabled={!canRedo}
        title="やり直す (Ctrl+Y)"
        onclick={onRedo}
      >
        ↷ やり直し
      </button>

      <button
        type="button"
        class="collapse-close-btn"
        title="注釈ツールバーを折りたたむ (F3)"
        onclick={onCloseAnnotationBar}
      >
        ▴ 閉じる
      </button>
    </div>
  </div>
{/if}

{#if searchOpen}
  <div class="collapsible-search-bar">
    <span class="row-label">🔍 テキスト検索:</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      autofocus
      type="text"
      class="search-input"
      placeholder="検索キーワードを入力 (Enterで次へ / Shift+Enterで前へ)..."
      value={searchQuery}
      oninput={(e) => onSearchQueryChange((e.currentTarget as HTMLInputElement).value)}
      onkeydown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onJumpNextSearchHit(e.shiftKey ? -1 : 1);
        } else if (e.key === "Escape") {
          onToggleSearch();
        }
      }}
    />
    <span class="search-hit-count">
      {searchHitPages.length > 0 ? `${searchHitPages.length} ページ該当` : "0 件"}
    </span>
    <button
      type="button"
      class="mini-action-btn"
      disabled={searchHitPages.length === 0}
      onclick={() => onJumpNextSearchHit(-1)}
    >
      ▲ 前へ
    </button>
    <button
      type="button"
      class="mini-action-btn"
      disabled={searchHitPages.length === 0}
      onclick={() => onJumpNextSearchHit(1)}
    >
      ▼ 次へ
    </button>
    <button
      type="button"
      class="collapse-close-btn"
      title="検索バーを閉じる (Esc)"
      onclick={onToggleSearch}
    >
      ×
    </button>
  </div>
{/if}

<style>
  .collapsible-annotation-bar,
  .collapsible-search-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 10px;
    gap: 8px;
    flex-wrap: wrap;
    background: var(--nord0);
    border-bottom: 1px solid var(--ui-border);
    font-size: 12px;
    user-select: none;
  }

  .collapsible-search-bar {
    justify-content: flex-start;
  }

  .tool-selector,
  .style-selector {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }

  .row-label {
    font-size: 11px;
    color: var(--nord4);
    font-weight: 700;
  }

  .tool-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-border);
    font-size: 11px;
  }

  .tool-btn:hover:not(:disabled) {
    border-color: var(--ui-accent);
    color: var(--ui-fg-bright);
  }

  .tool-btn.active {
    background: var(--ui-accent);
    color: #111827;
    border-color: var(--ui-accent);
    font-weight: 700;
  }

  .tool-btn kbd {
    font-size: 10px;
    opacity: 0.75;
    padding: 0 3px;
    border-radius: 2px;
    background: rgba(0, 0, 0, 0.15);
  }

  .color-swatches {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .color-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid transparent;
    padding: 0;
  }

  .color-dot.selected {
    border-color: #ffffff;
    box-shadow: 0 0 0 1px var(--ui-accent);
    transform: scale(1.1);
  }

  .mini-select {
    padding: 2px 5px;
    font-size: 11px;
  }

  .bg-fill-check {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    font-size: 11px;
  }

  .mini-action-btn,
  .collapse-close-btn {
    padding: 2px 7px;
    font-size: 11px;
    background: var(--ui-panel-bg);
    border: 1px solid var(--ui-border);
    color: var(--ui-fg);
  }

  .mini-action-btn:hover:not(:disabled),
  .collapse-close-btn:hover {
    border-color: var(--ui-accent);
    color: var(--ui-fg-bright);
  }

  .search-input {
    width: 240px;
    padding: 3px 7px;
    font-size: 12px;
  }

  .search-hit-count {
    font-size: 11px;
    color: var(--nord13);
    font-weight: 700;
  }
</style>

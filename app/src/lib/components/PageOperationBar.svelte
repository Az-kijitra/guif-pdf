<script lang="ts">
  interface Props {
    totalPages: number;
    currentPage: number;
    selectedCount: number;
    isCurrentPageSelected: boolean;
    pageSpecText: string;
    pageSpecError: string | null;
    hasPdf: boolean;
    onPageSpecInputChange: (val: string) => void;
    onToggleCurrentPageSelect: () => void;
    onSelectPreset: (preset: "all" | "none" | "invert" | "odd" | "even" | "from_current" | "to_current") => void;
    onRotateSelectedOrCurrent: (delta: number) => void;
    onDeleteSelectedPages: () => void;
    onOpenExtractModal: () => void;
    onOpenSplitModal: () => void;
    onOpenMergeModal: () => void;
    onClosePageBar?: () => void;
  }

  let {
    totalPages,
    currentPage,
    selectedCount,
    isCurrentPageSelected,
    pageSpecText,
    pageSpecError,
    hasPdf,
    onPageSpecInputChange,
    onToggleCurrentPageSelect,
    onSelectPreset,
    onRotateSelectedOrCurrent,
    onDeleteSelectedPages,
    onOpenExtractModal,
    onOpenSplitModal,
    onOpenMergeModal,
    onClosePageBar,
  }: Props = $props();
</script>

<div class="page-op-bar">
  <!-- Left: Page Number Specification & Quick Selection -->
  <div class="spec-section">
    <span class="spec-label" title="GUIでのチェック選択と双方向同期します">
      ページ指定:
    </span>
    <div class="spec-input-wrap">
      <input
        type="text"
        class="spec-input"
        class:has-error={!!pageSpecError}
        disabled={!hasPdf}
        placeholder="例: 1-5, 8, 12-end, odd, even, !3 (GUI選択と連動)"
        value={pageSpecText}
        oninput={(e) => onPageSpecInputChange((e.currentTarget as HTMLInputElement).value)}
      />
      <span class="selected-count-badge" class:active={selectedCount > 0}>
        {selectedCount} / {totalPages} 選択中
      </span>
    </div>

    <div class="quick-preset-btns">
      <button
        type="button"
        class="q-btn"
        class:active={isCurrentPageSelected}
        disabled={!hasPdf}
        title="現在表示中のページを選択/解除 (Space)"
        onclick={onToggleCurrentPageSelect}
      >
        {isCurrentPageSelected ? "✓ 現ページ" : "+ 現ページ"} (P.{currentPage})
      </button>
      <button
        type="button"
        class="q-btn"
        disabled={!hasPdf}
        title="全ページを選択 (all)"
        onclick={() => onSelectPreset("all")}
      >
        全選択
      </button>
      <button
        type="button"
        class="q-btn"
        disabled={!hasPdf || selectedCount === 0}
        title="すべての選択を解除"
        onclick={() => onSelectPreset("none")}
      >
        解除
      </button>
      <button
        type="button"
        class="q-btn"
        disabled={!hasPdf}
        title="現在の選択状態を反転"
        onclick={() => onSelectPreset("invert")}
      >
        反転
      </button>
      <button
        type="button"
        class="q-btn"
        disabled={!hasPdf}
        title="奇数ページのみ選択 (odd)"
        onclick={() => onSelectPreset("odd")}
      >
        奇数
      </button>
      <button
        type="button"
        class="q-btn"
        disabled={!hasPdf}
        title="偶数ページのみ選択 (even)"
        onclick={() => onSelectPreset("even")}
      >
        偶数
      </button>
      <button
        type="button"
        class="q-btn"
        disabled={!hasPdf}
        title="現在のページから最終ページまでを選択"
        onclick={() => onSelectPreset("from_current")}
      >
        P.{currentPage}〜末尾
      </button>
    </div>
  </div>

  <!-- Right: Page Manipulation Operations -->
  <div class="ops-section">
    <div class="op-group">
      <span class="op-group-label">
        {selectedCount > 0 ? `選択 (${selectedCount}P):` : `現ページ (P.${currentPage}):`}
      </span>
      <button
        type="button"
        class="op-btn"
        disabled={!hasPdf}
        title="選択ページ（未選択時は現在ページ）を左に90°回転 (Shift+R)"
        onclick={() => onRotateSelectedOrCurrent(-90)}
      >
        ↺ 左90°
      </button>
      <button
        type="button"
        class="op-btn"
        disabled={!hasPdf}
        title="選択ページ（未選択時は現在ページ）を右に90°回転 (R)"
        onclick={() => onRotateSelectedOrCurrent(90)}
      >
        ↻ 右90°
      </button>
      <button
        type="button"
        class="op-btn"
        disabled={!hasPdf}
        title="選択ページ（未選択時は現在ページ）を180°回転"
        onclick={() => onRotateSelectedOrCurrent(180)}
      >
        180°
      </button>
    </div>

    <div class="divider"></div>

    <div class="op-group">
      <button
        type="button"
        class="op-btn primary"
        disabled={!hasPdf}
        title="指定ページを新しいPDFファイルとして抽出"
        onclick={onOpenExtractModal}
      >
        ✂ 抽出
      </button>
      <button
        type="button"
        class="op-btn primary"
        disabled={!hasPdf}
        title="ページ番号や均等ページ数で複数のPDFファイルに分割"
        onclick={onOpenSplitModal}
      >
        ⇕ 分割
      </button>
      <button
        type="button"
        class="op-btn primary"
        title="複数のPDFファイルをページ指定付きで結合"
        onclick={onOpenMergeModal}
      >
        ⊕ 結合
      </button>
      <button
        type="button"
        class="op-btn danger"
        disabled={!hasPdf}
        title="選択ページ（未選択時は現在ページ）を削除 (Ctrl+Zで元に戻せます)"
        onclick={onDeleteSelectedPages}
      >
        🗑 削除
      </button>
      {#if onClosePageBar}
        <button
          type="button"
          class="op-btn"
          title="ページ操作バーを折りたたむ (F2)"
          onclick={onClosePageBar}
        >
          ▴ 閉じる
        </button>
      {/if}
    </div>
  </div>
</div>

{#if pageSpecError}
  <div class="spec-error-banner">
    ⚠ ページ指定エラー: {pageSpecError}
  </div>
{/if}

<style>
  .page-op-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding: 6px 12px;
    background: var(--ui-panel-bg);
    border-bottom: 1px solid var(--ui-border);
    font-size: 12px;
  }

  .spec-section {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    flex: 1;
    min-width: 420px;
  }

  .spec-label {
    font-weight: 700;
    color: var(--ui-accent);
    white-space: nowrap;
  }

  .spec-input-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 240px;
    max-width: 420px;
  }

  .spec-input {
    width: 100%;
    padding: 4px 8px;
    font-size: 12px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    color: var(--ui-fg-bright);
  }

  .spec-input.has-error {
    border-color: var(--ui-danger);
    outline-color: var(--ui-danger);
  }

  .selected-count-badge {
    white-space: nowrap;
    padding: 2px 8px;
    border-radius: 12px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    font-size: 11px;
    color: var(--ui-fg);
  }

  .selected-count-badge.active {
    background: var(--ui-accent);
    color: #111827;
    border-color: var(--ui-accent);
    font-weight: 700;
  }

  .quick-preset-btns {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: wrap;
  }

  .q-btn {
    padding: 3px 7px;
    font-size: 11px;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    color: var(--ui-fg);
  }

  .q-btn:hover:not(:disabled) {
    background: var(--ui-hover-bg);
    border-color: var(--ui-accent);
    color: var(--ui-fg-bright);
  }

  .q-btn.active {
    background: var(--nord2);
    border-color: var(--ui-accent);
    color: var(--ui-accent);
    font-weight: 700;
  }

  .ops-section {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .op-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .op-group-label {
    font-size: 11px;
    color: var(--nord4);
    margin-right: 2px;
    white-space: nowrap;
  }

  .divider {
    width: 1px;
    height: 18px;
    background: var(--ui-border);
  }

  .op-btn {
    padding: 4px 9px;
    font-size: 12px;
    font-weight: 600;
    background: var(--nord0);
    border: 1px solid var(--ui-border);
    color: var(--ui-fg-bright);
    white-space: nowrap;
  }

  .op-btn:hover:not(:disabled) {
    background: var(--ui-hover-bg);
    border-color: var(--ui-accent);
  }

  .op-btn.primary {
    background: var(--nord2);
    border-color: var(--ui-accent-blue);
  }

  .op-btn.primary:hover:not(:disabled) {
    background: var(--ui-accent);
    color: #111827;
    border-color: var(--ui-accent);
  }

  .op-btn.danger:hover:not(:disabled) {
    background: var(--ui-danger);
    color: #ffffff;
    border-color: var(--ui-danger);
  }

  .spec-error-banner {
    padding: 4px 12px;
    background: rgba(191, 97, 106, 0.2);
    border-bottom: 1px solid var(--ui-danger);
    color: var(--ui-fg-bright);
    font-size: 12px;
  }
</style>
